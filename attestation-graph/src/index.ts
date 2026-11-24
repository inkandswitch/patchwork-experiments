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
];
