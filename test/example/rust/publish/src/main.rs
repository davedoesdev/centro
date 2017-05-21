extern crate reqwest;
use std::io;
use std::env;
use reqwest::{Url, Client};

fn main() {
    let url_str = "http://localhost:8802/centro/v1/publish";
    let token = env::var("CENTRO_TOKEN").expect("no token");
    let topic = env::args().nth(1).expect("no topic");
    let url = Url::parse_with_params(url_str, &[
        ("authz_token", token),
        ("topic", topic)])
        .expect("Failed to parse url");
    let mut response = Client::new().expect("Couldn't create client")
        .post(url)
        .body(reqwest::Body::new(io::stdin()))
        .send()
        .expect("Failed to send request");
    let _ = io::copy(&mut response, &mut io::stdout());
}
