// Example document for fresh accounts (aggregated into the bundle's init.js).
// Standalone: builds the doc shape inline (mirrors SequenceDatatype.init and
// turnIntoSampleSequence) instead of going through the plugin registry.

const SAMPLE_VIDEO_URL =
  "https://diffusion-studio-public.s3.eu-central-1.amazonaws.com/videos/big_buck_bunny_1080p_30fps.mp4";

export default async function example(repo) {
  const handle = await repo.create2({
    "@patchwork": {
      type: "sequence",
      suggestedImportUrl: new URL("./dist/index.js", import.meta.url).href,
    },
    title: "Example video edit",
    sources: {
      "sample-source-1": { type: "video", url: SAMPLE_VIDEO_URL },
    },
    // Two tracks: a 3s cut from 10s in, over the full video from the start.
    tracks: [
      {
        id: crypto.randomUUID(),
        clips: [
          {
            id: crypto.randomUUID(),
            sourceId: "sample-source-1",
            time: 5,
            sourceInTime: 10,
            duration: 3,
          },
        ],
      },
      {
        id: crypto.randomUUID(),
        clips: [
          {
            id: crypto.randomUUID(),
            sourceId: "sample-source-1",
            time: 0,
            sourceInTime: null,
            duration: null,
          },
        ],
      },
    ],
  });

  return { name: "Example video edit", type: "sequence", url: handle.url };
}
