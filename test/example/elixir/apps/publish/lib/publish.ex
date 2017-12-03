defmodule Publish do
  def main([topic | _]) do
    HTTPoison.post!("http://localhost:8802/centro/v2/publish",
                    {:stream, IO.stream(:stdio, 100)},
                    [],
                    params: %{authz_token: System.get_env("CENTRO_TOKEN"),
                              topic: topic})
  end
end
