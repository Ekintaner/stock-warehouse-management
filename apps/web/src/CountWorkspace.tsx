import { useCallback, useEffect, useState, type FormEvent } from "react";

interface Props {
  csrfToken: string;
  role: string;
  userId: string;
  path: string;
}
interface Warehouse {
  id: string;
  name: string;
  code: string;
}
interface Count {
  id: string;
  countNumber: string;
  status: string;
  warehouse: Warehouse;
  updatedAt: string;
  startedAt: string;
  totalLines?: number;
  countedLines?: number;
}
interface Line {
  id: string;
  product: { sku: string; name: string };
  unit: string;
  snapshotQuantity: string;
  countedQuantity: string | null;
  difference: string | null;
}
interface Detail {
  count: Count;
  lines: Line[];
  linesTotal: number;
  page: number;
  stats: {
    totalLines: number;
    uncountedLines: number;
    positiveCount: number;
    negativeCount: number;
    zeroCount: number;
  };
}
const labels: Record<string, string> = {
  OPEN: "Açık",
  APPROVED: "Onaylandı",
  CANCELLED: "İptal",
  EACH: "Adet",
  KILOGRAM: "Kg",
  METER: "Metre",
};

export default function CountWorkspace({
  csrfToken,
  role,
  userId,
  path,
}: Props) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<{
    kind: string;
    key: string;
    body: string;
  } | null>(null);
  const id = path.split("/")[2];
  const dirty = Object.keys(draft).length > 0;

  const api = useCallback(
    async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          ...init.headers,
        },
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message ?? "İşlem tamamlanamadı.");
      return payload as T;
    },
    [csrfToken],
  );

  useEffect(() => {
    let active = true;
    async function loadWarehouses() {
      const items: Warehouse[] = [];
      for (let p = 1; ; p++) {
        const result = await api<{ items: Warehouse[]; total: number }>(
          `/api/warehouses?page=${p}&pageSize=100&isActive=true`,
        );
        items.push(...result.items);
        if (items.length >= result.total || !result.items.length) break;
      }
      if (active) setWarehouses(items);
    }
    void loadWarehouses().catch((e: unknown) => {
      if (active) setError(String(e));
    });
    return () => {
      active = false;
    };
  }, [api]);

  const reload = useCallback(async () => {
    if (id && id !== "new") {
      const result = await api<Detail>(
        `/api/counts/${id}?${new URLSearchParams({ page: String(page), pageSize: "25", q, filter })}`,
      );
      setDetail(result);
      setTotal(result.linesTotal);
    } else if (id !== "new") {
      const result = await api<{ items: Count[]; total: number }>(
        `/api/counts?${new URLSearchParams({ page: String(page), pageSize: "25", ...(warehouseId ? { warehouseId } : {}), ...(status ? { status } : {}) })}`,
      );
      setCounts(result.items);
      setTotal(result.total);
    }
  }, [api, id, page, q, filter, warehouseId, status]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void reload()
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : "Sayım yüklenemedi.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      if (
        (e.target as Element).closest("a") &&
        !window.confirm(
          "Kaydedilmemiş miktarlar var. Ayrılmak istiyor musunuz?",
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);
  function go(url: string) {
    window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setPage(1);
    setDraft({});
    setDetail(null);
    setAction(null);
  }
  async function open(e: FormEvent) {
    e.preventDefault();
    if (
      !window.confirm(
        "Sayım kapanana kadar bu depoda stok hareketleri durdurulacak. Devam edilsin mi?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: string }>("/api/counts", {
        method: "POST",
        body: JSON.stringify({ warehouseId, responsibleUserId: userId }),
      });
      go(`/counts/${result.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sayım açılamadı.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/counts/${detail.count.id}/lines`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedUpdatedAt: detail.count.updatedAt,
          lines: Object.entries(draft).map(([lineId, value]) => ({
            lineId,
            countedQuantity:
              value.trim() === "" ? null : value.trim().replace(",", "."),
          })),
        }),
      });
      setDraft({});
      await reload();
      setNotice("Sayım miktarları kaydedildi.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }
  async function finish(kind: string) {
    if (!detail) return;
    let pending = action;
    if (!pending) {
      const summary =
        kind === "approve"
          ? `${detail.stats.positiveCount} fazla, ${detail.stats.negativeCount} eksik, ${detail.stats.zeroCount} eşit satır. Farklar stoğa uygulanacak. Onaylıyor musunuz?`
          : "Sayım iptal edilecek; stok değişmeyecek. Devam edilsin mi?";
      if (!window.confirm(summary)) return;
      pending = {
        kind,
        key: crypto.randomUUID(),
        body: JSON.stringify({ expectedUpdatedAt: detail.count.updatedAt }),
      };
      setAction(pending);
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/counts/${detail.count.id}/${pending.kind}`, {
        method: "POST",
        headers: { "Idempotency-Key": pending.key },
        body: pending.body,
      });
      setAction(null);
      await reload();
      setNotice("Sayım kapatıldı.");
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "İşlem tamamlanamadı."} Sonuç belirsizse aynı işlemi tekrar deneyebilirsiniz.`,
      );
    } finally {
      setBusy(false);
    }
  }
  const pages = Math.max(1, Math.ceil(total / 25));
  return (
    <section>
      <div className="page-header">
        <div>
          <h1>
            {id === "new"
              ? "Yeni sayım"
              : detail
                ? `Sayım #${detail.count.countNumber}`
                : "Stok sayımları"}
          </h1>
          <p className="help-note">
            Fiziksel stok ile kayıtlı miktarı karşılaştırın.
          </p>
        </div>
        {!id && role !== "VIEWER" && (
          <button className="primary-button" onClick={() => go("/counts/new")}>
            Sayım aç
          </button>
        )}
        {id && (
          <button
            className="secondary-button"
            disabled={dirty || busy}
            onClick={() => go("/counts")}
          >
            Listeye dön
          </button>
        )}
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-banner" role="status">
          {notice}
        </p>
      )}
      {id === "new" ? (
        <form className="data-form" onSubmit={(e) => void open(e)}>
          <label>
            Depo
            <select
              required
              aria-label="Depo"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">Depo seçin</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            Sayım sorumlusu siz olacaksınız. Sayım sırasında bu depoda stok
            giriş, çıkış ve transfer hareketleri durur.
          </p>
          <button
            className="primary-button"
            disabled={busy || role === "VIEWER"}
          >
            Sayımı başlat
          </button>
        </form>
      ) : (
        <>
          <div className="filters">
            {!id ? (
              <>
                <label>
                  Depo
                  <select
                    aria-label="Depo"
                    value={warehouseId}
                    onChange={(e) => {
                      setWarehouseId(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Tüm yetkili depolar</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Durum
                  <select
                    aria-label="Durum"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Tümü</option>
                    {["OPEN", "APPROVED", "CANCELLED"].map((s) => (
                      <option key={s} value={s}>
                        {labels[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  Ürün ara
                  <input
                    disabled={dirty || busy}
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
                <label>
                  Satırlar
                  <select
                    disabled={dirty || busy}
                    aria-label="Satırlar"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">Tümü</option>
                    <option value="uncounted">Sayılmamış</option>
                    <option value="difference">Fark bulunan</option>
                  </select>
                </label>
              </>
            )}
          </div>
          {loading ? (
            <p role="status">Yükleniyor…</p>
          ) : detail && id ? (
            <>
              <p>
                <strong>{detail.count.warehouse.name}</strong> ·{" "}
                {labels[detail.count.status]} · {detail.stats.totalLines} satır,{" "}
                {detail.stats.uncountedLines} sayılmamış
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>SKU / Ürün</th>
                      <th>Birim</th>
                      <th>Sistem</th>
                      <th>Sayılan</th>
                      <th>Kaydedilmiş fark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => (
                      <tr key={l.id}>
                        <td>
                          {l.product.sku}
                          <br />
                          {l.product.name}
                        </td>
                        <td>{labels[l.unit]}</td>
                        <td>{l.snapshotQuantity}</td>
                        <td>
                          {detail.count.status === "OPEN" &&
                          role !== "VIEWER" ? (
                            <input
                              aria-label={`${l.product.sku} sayılan miktar`}
                              inputMode="decimal"
                              disabled={busy || Boolean(action)}
                              value={draft[l.id] ?? l.countedQuantity ?? ""}
                              onChange={(e) =>
                                setDraft({ ...draft, [l.id]: e.target.value })
                              }
                              placeholder="Henüz sayılmadı"
                            />
                          ) : (
                            (l.countedQuantity ?? "Sayılmadı")
                          )}
                        </td>
                        <td>{l.difference ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {detail.count.status === "OPEN" && (
                <div className="form-actions">
                  <button
                    className="primary-button"
                    disabled={!dirty || busy || Boolean(action)}
                    onClick={() => void save()}
                  >
                    Miktarları kaydet
                  </button>
                  {role === "ADMIN" && (
                    <>
                      <button
                        className="primary-button"
                        disabled={
                          dirty ||
                          busy ||
                          detail.stats.uncountedLines > 0 ||
                          Boolean(action && action.kind !== "approve")
                        }
                        onClick={() => void finish("approve")}
                      >
                        {action?.kind === "approve"
                          ? "Onayı tekrar dene"
                          : "Farkları onayla"}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={
                          dirty ||
                          busy ||
                          Boolean(action && action.kind !== "cancel")
                        }
                        onClick={() => void finish("cancel")}
                      >
                        {action?.kind === "cancel"
                          ? "İptali tekrar dene"
                          : "Sayımı iptal et"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sayım</th>
                    <th>Depo</th>
                    <th>Durum</th>
                    <th>Başlangıç</th>
                    <th>İlerleme</th>
                  </tr>
                </thead>
                <tbody>
                  {counts.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => go(`/counts/${c.id}`)}
                        >
                          #{c.countNumber}
                        </button>
                      </td>
                      <td>{c.warehouse.name}</td>
                      <td>{labels[c.status]}</td>
                      <td>{new Date(c.startedAt).toLocaleString("tr-TR")}</td>
                      <td>
                        {c.countedLines}/{c.totalLines}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!counts.length && (
                <p className="state-message">Henüz sayım bulunmuyor.</p>
              )}
            </div>
          )}
          <div className="pagination">
            <button
              disabled={page <= 1 || dirty || busy}
              onClick={() => setPage(page - 1)}
            >
              Önceki
            </button>
            <span>
              {page} / {pages}
            </span>
            <button
              disabled={page >= pages || dirty || busy}
              onClick={() => setPage(page + 1)}
            >
              Sonraki
            </button>
          </div>
        </>
      )}
    </section>
  );
}
