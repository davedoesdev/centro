extern crate reqwest;
extern crate eventsource;
extern crate encoding;
#[macro_use]
extern crate serde_derive;
extern crate serde;
extern crate serde_json;
use std::io::{self, Write};
use std::env;
use reqwest::Url;
use eventsource::event::Event;
use eventsource::reqwest::Client;
use encoding::{Encoding, EncoderTrap};
use encoding::all::ISO_8859_1;

#[derive(Deserialize)]
struct Start {
    topic: String
}

#[derive(Deserialize)]
struct Data {
    data: String
}

fn parse<'a, T>(data: &'a str) -> Option<T>
where T: serde::Deserialize<'a> {
    match serde_json::from_str::<T>(data) {
        Ok(start) => {
            return Some(start);
        },
        Err(err) => { 
            // TODO: how print to stderr?
            println!("Failed to parse JSON: {}", err);
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
            println!("Failed to covert data to bytes: {}", err);
            return None;
        }
    }
}

fn handle<'a, T>(ev: &'a Event, f: &Fn(T) -> ())
where T: serde::Deserialize<'a> {
    if let Some(v) = parse::<T>(&ev.data) {
        f(v);
    }
}

fn main() {
    let url_str = "http://localhost:8802/centro/v1/subscribe";
    let token = env::var("CENTRO_TOKEN").expect("no token");
    let topic = env::args().nth(1).expect("no topic");
    let url = Url::parse_with_params(url_str, &[
        ("authz_token", token),
        ("topic", topic)])
        .expect("Failed to parse url");
    let client = Client::new(url).expect("Failed to start EventSource");
    for event in client {
        let ev = event.expect("Failed to read event");
        if let Some(ref evtype) = ev.event_type {
            match evtype.as_str() {
                "start" =>
                    handle::<Start>(&ev, &|start| 
                        println!("topic: {}", start.topic)),
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
