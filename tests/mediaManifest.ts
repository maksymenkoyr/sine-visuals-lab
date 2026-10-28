// Every file under public/media/ with its sha256, as committed. A file listed
// here never changes and never goes (src/pinnedAssets.ts's header, "Scene
// media"): a tab loaded before a deploy may still fetch it. A new version is a
// new file name and a new line here; tests/sceneMedia.test.ts checks all of it
// and prints the line for a file that's missing.
export const MEDIA_MANIFEST: Readonly<Record<string, string>> = {
  "/media/alien/loop0-v1.mp4": "6175b6adbd0fc0b9b2cbe677462dfe41a90aef812c28d3136e74418371243386",
  "/media/alien/loop1-v1.mp4": "f0f5196058a3a26895bea3d5e8dc11f447eb9bcf7ae5034f3f937fe493baf469",
  "/media/alien/loop2-v1.mp4": "96430e4509ffd39bdeeb95a60a56e68c5851657855ce40104d4f9ccfa134ff1a",
  "/media/alien/mesh-v1.bin": "1d09b92a1a66433432e42772f00bf901e7e16521a6ce7d714592bea6ed2254cc",
  "/media/dancers/clips-v1.bin": "b7e3fcdfe5b10d3a25334403733da9047c29a276e3978c8a797172e249c59a27",
};
