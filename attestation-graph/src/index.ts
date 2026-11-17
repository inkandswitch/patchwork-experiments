// Entry module: parsed in a worker, so metadata + thin load()s only.
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "attestation-graph",
    name: "Attestation Graph",
    icon: "Network",
    async load() {
      return (await import("./datatype")).AttestationGraphDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "attestation-graph",
    name: "Attestation Graph",
    icon: "Network",
    supportedDatatypes: ["attestation-graph"],
    async load() {
      return (await import("./tool")).default;
    },
  },
  {
    // names and draws a comment thread's target cells in the comments sidebar
    type: "patchwork:ref-view",
    id: "attestation-graph-ref",
    name: "Attestation graph ref",
    supportedDatatypes: ["attestation-graph"],
    async load() {
      return (await import("./ref-view")).default;
    },
  },
];
