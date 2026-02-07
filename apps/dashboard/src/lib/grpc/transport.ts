import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";

export const transport = new GrpcWebFetchTransport({
  baseUrl: typeof window !== "undefined" ? `${window.location.origin}/api/grpc` : "http://127.0.0.1:50051",
});
