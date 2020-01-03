defmodule Subscribe do
  def main(topics) do
    {:ok, _} = EventsourceEx.new(
      "http://localhost:8802/centro/v2/subscribe?" <>
      URI.encode_query([{"authz_token", System.get_env("CENTRO_TOKEN")} |
                        (for topic <- topics, do: {"topic", topic})]),
      headers: [],
      stream_to: self())
      loop()
  end
  defmodule Start do
    defstruct [:id, :topic]
  end
  defmodule Data do
    defstruct [:id, :data]
  end
  def loop do
    receive do
      %EventsourceEx.Message{event: "start", data: data} ->
        start = Poison.decode!(data, as: %Start{})
        :io.format("id: ~B topic: ~s~n", [start.id, start.topic])
      %EventsourceEx.Message{event: "data", data: data} ->
        data = Poison.decode!(data, as: %Data{})
        IO.write(:unicode.characters_to_binary(data.data, :utf8, :latin1))
    end
    loop()
  end
end
