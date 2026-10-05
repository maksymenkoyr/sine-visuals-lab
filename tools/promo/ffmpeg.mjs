// A working ffmpeg for the promo tools. Homebrew's ffmpeg on this machine is
// broken (missing libx265), so the default is imageio-ffmpeg's static build,
// fetched through uv; set FFMPEG to use another binary.
import { execFileSync } from "node:child_process";

let cached = process.env.FFMPEG || null;

export function ffmpegPath() {
  if (!cached) {
    cached = execFileSync("uv", ["run", "--quiet", "--with", "imageio-ffmpeg", "python", "-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" }).trim();
  }
  return cached;
}

export function ffmpeg(args, opts = {}) {
  return execFileSync(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8", maxBuffer: 256 << 20, ...opts });
}
