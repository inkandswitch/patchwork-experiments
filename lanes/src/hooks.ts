import { useEffect, useState } from "react";
import {
  getRegistry,
  type DatatypeDescription,
  type Plugin,
} from "@inkandswitch/patchwork-plugins";

export function useDatatypePlugins(): Plugin<DatatypeDescription>[] {
  const [datatypes, setDatatypes] = useState(() =>
    getRegistry<DatatypeDescription>("patchwork:datatype").all(),
  );

  useEffect(() => {
    const registry = getRegistry<DatatypeDescription>("patchwork:datatype");
    const update = () => setDatatypes([...registry.all()]);
    return registry.on("changed", update);
  }, []);

  return datatypes;
}
