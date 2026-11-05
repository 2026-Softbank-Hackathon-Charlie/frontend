import { sha256Hex, textOf } from "./attachment";

const buf = (b: number[] | string) => (typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b)).buffer as ArrayBuffer;

describe("plan attachment content", () => {
  it("shows UTF-8 text, and treats NUL bytes or invalid UTF-8 as binary", () => {
    expect(textOf(buf("replicas: 2\n# 한글\n"))).toBe("replicas: 2\n# 한글\n");
    expect(textOf(buf([0x6b, 0x00, 0x6b]))).toBeUndefined();
    expect(textOf(buf([0xff, 0xfe, 0x41]))).toBeUndefined();
  });

  it("hashes the content as lower-case hex SHA-256", async () => {
    expect(await sha256Hex(buf("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
