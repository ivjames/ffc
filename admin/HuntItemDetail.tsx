import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type HuntItem, type HuntItemImage, type ItemImageScan } from './api';
import { BackLink, Button, Card, Field, Input, Banner, PageHeader, Pill, Spinner, Textarea, fmtDateTime, useAsync } from './ui';
import { ItemImageThumb } from './Hunt';

// One hunt item: its prompt variables (name, hint, and the extra judge
// prompt appended to the production vision call) and its vetting image set —
// people-free sample photos of the real prop, used to test the judge before
// the item goes live. Uploads are people-screened server-side (one cheap
// descriptor call each); the running burn tally below shows the exact billed
// tokens and cost of those screens, per the metering house rule.

type UploadResult = {
  fileName: string;
  outcome: 'added' | 'people' | 'error';
  detail?: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is a data: URL — strip the prefix, keep the raw base64.
      const text = String(reader.result);
      resolve(text.slice(text.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function ImageCard({ image, onRemoved }: { image: HuntItemImage; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="w-40">
      <ItemImageThumb imageId={image.id} alt={image.subject ?? 'vetting image'} className="h-40 w-40" />
      <div className="mt-1 flex items-start justify-between gap-1">
        <div className="min-w-0 text-xs text-slate-500">
          {image.subject && <div className="truncate font-medium text-slate-600">{image.subject}</div>}
          {image.note && <div className="truncate">{image.note}</div>}
          <div className="text-slate-400">{fmtDateTime(image.createdAt)}</div>
        </div>
        <button
          type="button"
          disabled={busy}
          className="text-xs text-red-600 underline disabled:text-slate-400"
          onClick={async () => {
            if (!window.confirm('Remove this vetting image? The file is deleted from the server.')) return;
            setBusy(true);
            setError('');
            try {
              await api.deleteHuntItemImage(image.id);
              onRemoved();
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? '…' : 'remove'}
        </button>
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}

export default function HuntItemDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => api.getHuntItem(id), [id]);

  // Form state, seeded from the loaded item via the `key` remount below.
  return (
    <div className="space-y-4">
      <BackLink to="/hunt">Scavenger hunt</BackLink>
      {error && <Banner kind="error">{error.message}</Banner>}
      {loading && <Spinner />}
      {data && (
        <Loaded
          key={`${data.item.id}:${JSON.stringify([data.item.name, data.item.slug, data.item.hint, data.item.extraPrompt, data.item.sortOrder, data.item.active, data.item.countable])}`}
          data={data}
          reload={reload}
          onDeleted={() => navigate('/hunt')}
        />
      )}
    </div>
  );
}

function Loaded({
  data,
  reload,
  onDeleted,
}: {
  data: { item: HuntItem; images: HuntItemImage[] };
  reload: () => void;
  onDeleted: () => void;
}) {
  const { item, images } = data;
  const [name, setName] = useState(item.name);
  const [slug, setSlug] = useState(item.slug);
  const [hint, setHint] = useState(item.hint ?? '');
  const [extraPrompt, setExtraPrompt] = useState(item.extraPrompt ?? '');
  const [sortOrder, setSortOrder] = useState(String(item.sortOrder));
  const [active, setActive] = useState(item.active);
  const [countable, setCountable] = useState(item.countable);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [deleteError, setDeleteError] = useState('');

  // Upload machinery: files screen one at a time; the tally accumulates the
  // exact billed tokens/cost of every screen this visit (rejections included).
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [burn, setBurn] = useState({ scans: 0, inTok: 0, outTok: 0, cost: 0 });

  const sortOrderInt = Number.parseInt(sortOrder, 10);
  const sortOrderValid = Number.isInteger(sortOrderInt);

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await api.patchHuntItem(item.id, {
        name: name.trim(),
        slug: slug.trim(),
        hint,
        extraPrompt,
        sortOrder: sortOrderInt,
        active,
        countable,
      });
      setSaveMsg({ kind: 'success', text: 'Saved.' });
      reload();
    } catch (err) {
      setSaveMsg({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Save failed',
      });
    } finally {
      // Always clear here: an unchanged save reloads into the same `key`, so
      // no remount comes along to reset this state.
      setSaving(false);
    }
  }

  async function uploadFiles(files: FileList) {
    setUploading(true);
    const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    for (const file of Array.from(files)) {
      try {
        if (!MEDIA_TYPES.has(file.type)) {
          setResults((r) => [...r, { fileName: file.name, outcome: 'error', detail: 'unsupported type' }]);
          continue;
        }
        const imageBase64 = await fileToBase64(file);
        const res = await api.uploadHuntItemImage(item.id, { imageBase64, mediaType: file.type });
        if (res.scan) {
          setBurn((b) => addBurn(b, res.scan!));
        }
        if (res.ok) {
          setResults((r) => [...r, { fileName: file.name, outcome: 'added', detail: res.image?.subject ?? undefined }]);
        } else {
          setResults((r) => [...r, { fileName: file.name, outcome: 'people' }]);
        }
      } catch (err) {
        setResults((r) => [...r, { fileName: file.name, outcome: 'error', detail: (err as Error).message }]);
      }
    }
    setUploading(false);
    reload();
  }

  return (
    <>
      <PageHeader
        title={item.name}
        titleExtra={
          <>
            <span className="text-sm text-slate-400">
              {item.locationName ? `${item.locationName} · ` : ''}
              {item.courseName}
            </span>
            {!item.active && <Pill tone="amber">inactive</Pill>}
            {item.countable && <Pill>countable</Pill>}
          </>
        }
      />

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Prompt variables</h2>
        <p className="text-xs text-slate-500">
          These are what the vision judge sees when a player submits a photo of this item.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" hint="What to find — interpolated into the judge prompt.">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Slug" hint="Stable key within the course (a-z, 0-9, hyphens).">
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
          </Field>
        </div>
        <Field label="Hint" hint="Shown to players, and given to the judge as context.">
          <Textarea rows={2} value={hint} onChange={(e) => setHint(e.target.value)} />
        </Field>
        <Field
          label="Extra judge prompt"
          hint="Admin-only judging guidance appended to the vision prompt for this item — e.g. “credit only the RED windmill, not the blue one by hole 4”. Players never see this."
        >
          <Textarea rows={3} value={extraPrompt} onChange={(e) => setExtraPrompt(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Sort order">
            <Input className="w-24" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (visible to players)
          </label>
          <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={countable} onChange={(e) => setCountable(e.target.checked)} />
            Countable (find as many as you can)
          </label>
        </div>
        {saveMsg && <Banner kind={saveMsg.kind}>{saveMsg.text}</Banner>}
        <Button onClick={save} disabled={saving || !name.trim() || !slug.trim() || !sortOrderValid}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Vetting images</h2>
        <p className="text-xs text-slate-500">
          Sample photos of the real prop, kept with the item for prompt-tuning before it goes live.
          (The vision bench keeps its own test dataset for judging runs — a one-click bridge from
          here is a planned follow-up.) Admin-only test data: each upload is screened by one cheap
          descriptor call (~$0.0002) and rejected if anyone is visible — images here get sent to
          model providers, so they must be people-free.
        </p>
        <div className="flex flex-wrap gap-4">
          {images.map((image) => (
            <ImageCard key={image.id} image={image} onRemoved={reload} />
          ))}
          {images.length === 0 && (
            <p className="py-2 text-sm text-slate-400">No vetting images yet.</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <Button variant="ghost" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? 'Screening…' : 'Upload images'}
          </Button>
          {burn.scans > 0 && (
            <span className="text-xs text-slate-500">
              Screened {burn.scans} {burn.scans === 1 ? 'image' : 'images'} · {burn.inTok.toLocaleString()} in /{' '}
              {burn.outTok.toLocaleString()} out tokens · ${burn.cost.toFixed(4)}
            </span>
          )}
        </div>
        {results.length > 0 && (
          <ul className="space-y-1 text-xs">
            {results.map((r, i) => (
              <li key={i}>
                {r.outcome === 'added' && (
                  <span className="text-emerald-700">
                    ✓ {r.fileName} added{r.detail ? ` — labeled “${r.detail}”` : ''}
                  </span>
                )}
                {r.outcome === 'people' && (
                  <span className="text-amber-700">
                    ✕ {r.fileName} rejected — people are visible; vetting images must be people-free
                  </span>
                )}
                {r.outcome === 'error' && (
                  <span className="text-red-700">
                    ✕ {r.fileName} failed{r.detail ? ` — ${r.detail}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Danger zone</h2>
        <p className="text-xs text-slate-500">
          Deleting removes the item and its vetting images. An item players have already found can’t
          be deleted (history is kept) — deactivate it instead.
        </p>
        {deleteError && <Banner kind="error">{deleteError}</Banner>}
        <Button
          variant="danger"
          onClick={async () => {
            if (!window.confirm(`Delete “${item.name}” and its vetting images?`)) return;
            setDeleteError('');
            try {
              await api.deleteHuntItem(item.id);
              onDeleted();
            } catch (err) {
              setDeleteError(err instanceof ApiError ? err.message : 'Delete failed');
            }
          }}
        >
          Delete item
        </Button>
      </Card>
    </>
  );
}

function addBurn(
  b: { scans: number; inTok: number; outTok: number; cost: number },
  scan: ItemImageScan
) {
  return {
    scans: b.scans + 1,
    inTok: b.inTok + (scan.inputTokens ?? 0),
    outTok: b.outTok + (scan.outputTokens ?? 0),
    cost: b.cost + (scan.cost ?? 0),
  };
}
