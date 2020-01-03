use serde_derive::Deserialize;
use std::io::{self, Write};
use std::env;
use reqwest::Url;
use eventsource::event::Event;
use eventsource::reqwest::Client;
use encoding::{Encoding, EncoderTrap};
use encoding::all::ISO_8859_1;
use log::error;
use env_logger;

#[derive(Deserialize)]
struct Start {
    id: u64,
    topic: String
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Data {
    id: u64,
    data: String
}

fn parse<'a, T>(data: &'a str) -> Option<T>
where T: serde::Deserialize<'a> {
    match serde_json::from_str::<T>(data) {
        Ok(start) => {
            return Some(start);
        },
        Err(err) => { 
            error!("Failed to parse JSON: {}", err);
            return None;
        }
    }
}

fn encode(data: &str) -> Option<Vec<u8>> {
    match ISO_8859_1.encode(data, EncoderTrap::Strict) {
        Ok(bytes) => {
            return Some(bytes);
        },
        Err(err) => {
            error!("Failed to covert data to bytes: {}", err);
            return None;
        }
    }
}

fn handle<'a, T>(ev: &'a Event, f: &dyn Fn(T) -> ())
where T: serde::Deserialize<'a> {
    if let Some(v) = parse::<T>(&ev.data) {
        f(v);
    }
}

fn main() {
    env_logger::init();
    let url_str = "http://localhost:8802/centro/v2/subscribe";
    let token = env::var("CENTRO_TOKEN").expect("no token");
    let token_params = vec![("authz_token", token)];
    let topic_params = env::args().skip(1).map(|topic| ("topic", topic));
    let url = Url::parse_with_params(url_str,
        token_params.into_iter().chain(topic_params))
        .expect("Failed to parse url");
    let client = Client::new(url);
    for event in client {
        let ev = event.expect("Failed to read event");
        if let Some(ref evtype) = ev.event_type {
            match evtype.as_str() {
                "start" =>
                    handle::<Start>(&ev, &|start| 
                        println!("id: {} topic: {}", start.id, start.topic)),
                "data" =>
                    handle::<Data>(&ev, &|data|
                        if let Some(bytes) = encode(&data.data) {
                            let _ = io::stdout().write(bytes.as_slice());
                            let _ = io::stdout().flush();
                        }),
                _ => {}
            }
        }
    }
}
