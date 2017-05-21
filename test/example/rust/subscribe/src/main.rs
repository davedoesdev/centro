extern crate reqwest;
extern crate eventsource;
#[macro_use]
extern crate serde_derive;
extern crate serde;
extern crate serde_json;
use std::io::{self, Write};
use std::env;
use reqwest::Url;
use eventsource::reqwest::Client;

#[derive(Deserialize)]
struct Start {
    topic: String
}

#[derive(Deserialize)]
struct Data {
    data: String
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
        match ev.event_type {
            Some(ref evtype) => {
// TODO: how print to stderr and continue?
// need to encode string as binary and print that
                match evtype.as_str() {
                    "start" => {
                        match serde_json::from_str::<Start>(&ev.data) {
                            Ok(start) => {
                                println!("topic: {}", start.topic);
                            },
                            Err(err) => { println!("Failed to parse start event: {}", err); }
                        }
                    },
                    "data" => {
                        match serde_json::from_str::<Data>(&ev.data) {
                            Ok(data) => {
                                print!("{}", data.data);
                                let _ = io::stdout().flush();
                            },
                            Err(err) => { println!("Failed to parse data event: {}", err); }
                        }
                    },
                    _ => {}
                }
            },
            None => {}
        }
    }
}
