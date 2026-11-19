import { useEffect, useState } from "react";
import { PageRows, PageSection } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";

/**
 * Admin, Providers: the endpoints and models this deployment actually serves.
 *
 * OpenBot's own provider page is read-only for a single-person deployment, and the server behind
 * it is not in this repository. These settings belong to the gateway in front of it, so they are
 * edited here against that gateway's config API rather than in a file on the host. Key values are
 * masked on the way back; leaving the key box empty keeps the one already saved.
 */

type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  prefixes: string[];
};

type GatewayConfig = {
  effort: string;
  models: string[];
  providers: Provider[];
};

type AvailableModel = {
  id: string;
  provider: string;
  providerName: string;
  capabilities: Record<string, unknown> | null;
  contextLength: number | null;
};

type Draft = {
  name: string;
  baseUrl: string;
  apiKey: string;
  prefixes: string;
};

const emptyDraft: Draft = { name: "", baseUrl: "", apiKey: "", prefixes: "" };

/** The gateway's own port on the host this page came from, so LAN and Tailscale both work. */
function endpoint(): string {
  return `${window.location.protocol}//${window.location.hostname}:20129`;
}

export function GatewaySettings() {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [available, setAvailable] = useState<AvailableModel[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () => {
    fetch(endpoint() + "/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: GatewayConfig | null) => {
        if (!body) throw new Error("The gateway did not answer.");
        setConfig(body);
        setSelected(new Set(body.models));
        setError("");
      })
      .catch((cause: unknown) => setError(String(cause)));
  };

  useEffect(load, []);

  const send = async (
    path: string,
    method: string,
    body: unknown,
    message: string,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint() + path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      const saved = result as GatewayConfig;
      setConfig(saved);
      setSelected(new Set(saved.models));
      setNotice(message);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = () => {
    setFetching(true);
    setError("");
    fetch(endpoint() + "/models/available")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { models?: AvailableModel[] } | null) => {
        if (!body) throw new Error("The endpoints did not answer.");
        setAvailable(body.models ?? []);
      })
      .catch((cause: unknown) => setError(String(cause)))
      .finally(() => setFetching(false));
  };

  const toggle = (id: string, on: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const edit = (provider: Provider) => {
    setEditing(provider.id);
    setDraft({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: "",
      prefixes: provider.prefixes.join(", "),
    });
  };

  const submitProvider = () => {
    const prefixes = draft.prefixes
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const body = {
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey,
      prefixes,
    };
    if (!body.name || !/^https?:\/\//.test(body.baseUrl)) {
      setError("Give the endpoint a name and an http(s) base URL.");
      return;
    }
    const path = editing ? `/providers/${encodeURIComponent(editing)}` : "/providers";
    void send(
      path,
      editing ? "PATCH" : "POST",
      body,
      editing ? "Endpoint saved." : "Endpoint added.",
    ).then(() => {
      setDraft(emptyDraft);
      setEditing(null);
    });
  };

  const query = filter.trim().toLowerCase();
  const shown = (available ?? []).filter(
    (model) =>
      model.id.toLowerCase().includes(query) ||
      model.providerName.toLowerCase().includes(query),
  );

  return (
    <PageSection
      description="Where model calls go, and which ones people may pick. Saved on the gateway, not in the app."
      title="Model connections"
    >
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p>{notice}</p> : null}
      {config === null ? (
        <p>Loading…</p>
      ) : (
        <>
          <PageRows>
            {config.providers.map((provider) => (
              <Item key={provider.id} size="sm">
                <ItemContent>
                  <ItemTitle>{provider.name}</ItemTitle>
                  <ItemDescription>
                    {provider.baseUrl} · {provider.apiKey || "no key"} ·{" "}
                    {provider.prefixes.join(", ") || "all models"}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button disabled={busy} onClick={() => edit(provider)} size="sm" variant="ghost">
                    Edit
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void send(
                        `/providers/${encodeURIComponent(provider.id)}`,
                        "DELETE",
                        {},
                        "Endpoint removed.",
                      )
                    }
                    size="sm"
                    variant="ghost"
                  >
                    Delete
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </PageRows>

          <div className="grid gap-2 py-4">
            <Input
              aria-label="Endpoint name"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Name, e.g. 9router (LAN)"
              value={draft.name}
            />
            <Input
              aria-label="Base URL"
              onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              placeholder="http://192.168.1.7:20128"
              value={draft.baseUrl}
            />
            <Input
              aria-label="API key"
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              placeholder="API key — leave empty to keep the saved one"
              type="password"
              value={draft.apiKey}
            />
            <Input
              aria-label="Model prefixes"
              onChange={(event) => setDraft({ ...draft, prefixes: event.target.value })}
              placeholder="Model prefixes, e.g. nous, cx, oc"
              value={draft.prefixes}
            />
            <div className="flex gap-2">
              <Button disabled={busy} onClick={submitProvider}>
                {editing ? "Save endpoint" : "Add endpoint"}
              </Button>
              {editing ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setEditing(null);
                    setDraft(emptyDraft);
                  }}
                  variant="ghost"
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>

          <Separator />

          <div className="grid gap-2 py-4">
            <div className="flex items-center justify-between gap-2">
              <label className="font-medium text-sm" htmlFor="model-filter">
                Visible models
              </label>
              <Button disabled={fetching} onClick={fetchModels} size="sm" variant="outline">
                {fetching ? "Fetching…" : "Fetch models"}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Fetch asks every configured endpoint what it offers. Pick what OpenBot may show.
              Changes reach the catalogue within about ten minutes.
            </p>

            {available === null ? (
              <p className="text-muted-foreground text-xs">
                Press Fetch models to see what the endpoints offer.
              </p>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    aria-label="Filter models"
                    id="model-filter"
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Filter by model id or endpoint"
                    value={filter}
                  />
                  <Button
                    disabled={selected.size === 0}
                    onClick={() => setSelected(new Set())}
                    size="sm"
                    variant="ghost"
                  >
                    None
                  </Button>
                  <Button
                    disabled={selected.size === available.length}
                    onClick={() => setSelected(new Set(available.map((m) => m.id)))}
                    size="sm"
                    variant="ghost"
                  >
                    All
                  </Button>
                </div>

                <div className="max-h-64 overflow-y-auto rounded-md border">
                  {shown.length === 0 ? (
                    <p className="p-2 text-muted-foreground text-xs">No models match.</p>
                  ) : (
                    shown.map((model) => (
                      <label
                        className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent"
                        key={model.id}
                      >
                        <Checkbox
                          aria-label={`Use ${model.id}`}
                          checked={selected.has(model.id)}
                          onCheckedChange={(checked) => toggle(model.id, checked === true)}
                        />
                        <span className="min-w-0 flex-1 truncate">{model.id}</span>
                        <span className="text-muted-foreground text-xs">{model.providerName}</span>
                      </label>
                    ))
                  )}
                </div>

                <div className="flex gap-2">
                  <Input
                    aria-label="Add model id"
                    onChange={(event) => setManual(event.target.value)}
                    placeholder="Add a model id by hand"
                    value={manual}
                  />
                  <Button
                    disabled={!manual.trim()}
                    onClick={() => {
                      toggle(manual.trim(), true);
                      setManual("");
                    }}
                    size="sm"
                  >
                    Add
                  </Button>
                </div>

                <p className="text-muted-foreground text-xs">{selected.size} selected</p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void send("/models", "PATCH", { models: [...selected] }, "Model list saved.")
                  }
                >
                  Save models
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </PageSection>
  );
}
