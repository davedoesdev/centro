use std::env;
use reqwest::{Url, Client, Body};
use tokio::io::stdin;
use tokio_util::codec::{FramedRead, BytesCodec};
use futures_util::stream::TryStreamExt;
use log::error;
use env_logger;

#[tokio::main]
async fn main() {
    env_logger::init();
    let url_str = "http://localhost:8802/centro/v2/publish";
    let token = env::var("CENTRO_TOKEN").expect("no token");
    let topic = env::args().nth(1).expect("no topic");
    let url = Url::parse_with_params(url_str, &[
        ("authz_token", token),
        ("topic", topic)])
        .expect("Failed to parse url");
    let st = FramedRead::new(stdin(), BytesCodec::new())
        .map_ok(bytes::BytesMut::freeze);
    let response = Client::new()
        .post(url)
        .body(Body::wrap_stream(st))
        .send()
        .await
        .expect("Failed to send request");
    if !response.status().is_success() {
        error!("HTTP request failed: {}", response.status());
        error!("{}", response.text().await.expect("Failed to read response"));
    }
}
