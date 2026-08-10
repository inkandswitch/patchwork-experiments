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
            className="btn btn--ghost btn--sm"
          >
            <Icon type="Settings" />
            {fieldConfigDoc ? fieldConfigDoc.title : "Select Configuration"}
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="dialog--full">
        <div className="config__head">
          <h2 className="config__title">Select Field Configuration</h2>
          <div className="config__field">
            <label>Configuration URL</label>
            <input
              type="text"
              value={fieldConfigUrl || ""}
              onChange={(e) =>
                handleConfigChange(e.target.value as AutomergeUrl)
              }
              className="input"
              placeholder="Enter configuration URL"
            />
          </div>
        </div>
        {fieldConfigDoc && (
          <div className="config__preview">
            <patchwork-view
              doc-url={fieldConfigUrl?.toString() || ""}
              tool-id="field-configuration"
              className="config__view"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
