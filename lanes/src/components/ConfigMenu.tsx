import React, { useEffect, useState } from "react";
import { useDocument } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Dialog, DialogTrigger, DialogContent, Icon } from "../ui";

interface Field {
  id: string;
  name: string;
  type: string;
  options?: string[];
  multiple?: boolean;
}

interface FieldConfigurationDoc {
  title: string;
  description?: string;
  fields: Field[];
  url: AutomergeUrl;
}

interface ConfigMenuProps {
  fieldConfigUrl?: AutomergeUrl;
  onConfigChange?: (url: AutomergeUrl) => void;
  dialogTrigger?: React.ReactNode;
}

export const ConfigMenu: React.FC<ConfigMenuProps> = ({
  fieldConfigUrl,
  onConfigChange,
  dialogTrigger,
}) => {
  const [fieldConfigDoc, setFieldConfigDoc] =
    useState<FieldConfigurationDoc | null>(null);

  const [configDoc] = useDocument<FieldConfigurationDoc>(
    fieldConfigUrl || undefined,
    { suspense: false },
  );

  useEffect(() => {
    if (configDoc) {
      setFieldConfigDoc(configDoc);
    } else {
      setFieldConfigDoc(null);
    }
  }, [configDoc]);

  const handleConfigChange = async (url: AutomergeUrl) => {
    onConfigChange?.(url);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {dialogTrigger ? (
          dialogTrigger
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm gap-2"
          >
            <Icon type="Settings" className="h-4 w-4" />
            {fieldConfigDoc ? fieldConfigDoc.title : "Select Configuration"}
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="flex h-full flex-col">
        <div className="flex-none border-b border-base-300 p-4">
          <h2 className="mb-4 text-lg font-medium">Select Field Configuration</h2>
          <div className="space-y-2">
            <label className="block text-sm font-medium">Configuration URL</label>
            <input
              type="text"
              value={fieldConfigUrl || ""}
              onChange={(e) =>
                handleConfigChange(e.target.value as AutomergeUrl)
              }
              className="input input-bordered w-full"
              placeholder="Enter configuration URL"
            />
          </div>
        </div>
        {fieldConfigDoc && (
          <div className="min-h-0 flex-1">
            <patchwork-view
              doc-url={fieldConfigUrl?.toString() || ""}
              tool-id="field-configuration"
              className="h-full"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
