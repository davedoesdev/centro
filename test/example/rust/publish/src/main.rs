extern crate reqwest;
use std::io::{self, Read};
use std::env;
use reqwest::{Url, Client};
#[macro_use] extern crate log;
extern crate env_logger;

fn main() {
    env_logger::init().expect("Failed to init logger");
    let url_str = "http://localhost:8802/centro/v2/publish";
    let token = env::var("CENTRO_TOKEN").expect("no token");
    let topic = env::args().nth(1).expect("no topic");
    let url = Url::parse_with_params(url_str, &[
        ("authz_token", token),
        ("topic", topic)])
        .expect("Failed to parse url");
    let response = Client::new()
        .post(url)
        .body(reqwest::Body::new(io::stdin()))
        .send()
        .expect("Failed to send request");
    if !response.status().is_success() {
        error!("HTTP request failed: {}", response.status());
        let mut buffer = String::new();
        response.take(10000).read_to_string(&mut buffer).expect("Failed to read response");
        error!("{}", buffer);
    }
}
