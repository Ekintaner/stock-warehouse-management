import { useCallback, useEffect, useState, type FormEvent } from "react";
interface Props {
  path: string;
  role: string;
  userId: string;
  csrfToken: string;
}
interface Warehouse {
  id: string;
  name: string;
}
interface Supplier {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  updatedAt: string;
}
interface User {
  id: string;
  username: string;
  displayName: string;
  role: string;
  isActive: boolean;
  updatedAt: string;
  warehouseAssignments: { warehouseId: string }[];
}
interface Stock {
  warehouseId: string;
  productId: string;
  warehouse: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  minimumStock: string;
}
interface Activity {
  warehouse: string;
  unit: string;
  direction: string;
  type: string;
  quantity: string;
  count: number;
}
interface Audit {
  id: string;
  createdAt: string;
  action: string;
  relatedType: string;
  relatedId: string;
  user: { displayName: string };
  changeSummary: unknown;
}
const names: Record<string, string> = {
  ADMIN: "Yönetici",
  WAREHOUSE_MANAGER: "Depo sorumlusu",
  VIEWER: "Görüntüleme",
  EACH: "Adet",
  KILOGRAM: "Kg",
  METER: "Metre",
  IN: "Giriş",
  OUT: "Çıkış",
  RECEIPT: "Stok girişi",
  ISSUE: "Stok çıkışı",
  COUNT_ADJUSTMENT: "Sayım farkı",
  REVERSAL: "Ters hareket",
  TRANSFER_SHIPMENT: "Transfer sevki",
  TRANSFER_RECEIPT: "Transfer teslimi",
  TRANSFER_RETURN: "Transfer dönüşü",
};
export default function OperationsWorkspace({
  path,
  role,
  userId,
  csrfToken,
}: Props) {
  const kind = path.split("/")[1];
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [summaries, setSummaries] = useState<
    {
      warehouse: string;
      unit: string;
      productCount: number;
      quantity: string;
    }[]
  >([]);
  const [summaryPage, setSummaryPage] = useState(1);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const api = useCallback(
    async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          ...init.headers,
        },
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message ?? "İşlem tamamlanamadı.");
      return data as T;
    },
    [csrfToken],
  );
  useEffect(() => {
    let active = true;
    async function load() {
      const all: Warehouse[] = [];
      for (let p = 1; ; p++) {
        const data = await api<{ items: Warehouse[]; total: number }>(
          `/api/warehouses?page=${p}&pageSize=100&isActive=true`,
        );
        all.push(...data.items);
        if (all.length >= data.total || !data.items.length) break;
      }
      if (active) setWarehouses(all);
    }
    void load().catch((e: unknown) => {
      if (active) setError(String(e));
    });
    return () => {
      active = false;
    };
  }, [api]);
  const stockQuery = new URLSearchParams({
    page: String(page),
    pageSize: "25",
    q,
    lowOnly: String(lowOnly),
    ...(warehouseId ? { warehouseId } : {}),
  }).toString();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    async function load() {
      if (kind === "suppliers") {
        const data = await api<{ items: Supplier[]; total: number }>(
          `/api/suppliers?page=${page}&pageSize=25&q=${encodeURIComponent(q)}`,
        );
        if (active) {
          setSuppliers(data.items);
          setTotal(data.total);
        }
      }
      if (kind === "users") {
        const data = await api<{ items: User[]; total: number }>(
          `/api/users?page=${page}&pageSize=25`,
        );
        if (active) {
          setUsers(data.items);
          setTotal(data.total);
        }
      }
      if (kind === "audit") {
        const data = await api<{ items: Audit[]; total: number }>(
          `/api/audit?page=${page}&pageSize=25`,
        );
        if (active) {
          setAudits(data.items);
          setTotal(data.total);
        }
      }
      if (kind === "reports") {
        const data = await api<{ items: Stock[]; total: number }>(
          `/api/reports/stock?${stockQuery}`,
        );
        const query = new URLSearchParams({
          ...(warehouseId ? { warehouseId } : {}),
          ...(from
            ? { startDate: new Date(`${from}T00:00:00`).toISOString() }
            : {}),
          ...(to
            ? { endDate: new Date(`${to}T23:59:59.999`).toISOString() }
            : {}),
        });
        const summary = await api<{
          items: {
            warehouse: string;
            unit: string;
            productCount: number;
            quantity: string;
          }[];
        }>(
          `/api/reports/warehouses?${new URLSearchParams({ page: String(summaryPage), pageSize: "25", ...(warehouseId ? { warehouseId } : {}) })}`,
        );
        const activity = await api<{ items: Activity[] }>(
          `/api/reports/activity?${query}`,
        );
        if (active) {
          setStocks(data.items);
          setTotal(data.total);
          setActivities(activity.items);
          setSummaries(summary.items);
        }
      }
    }
    void load()
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Yüklenemedi.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    api,
    kind,
    page,
    q,
    stockQuery,
    warehouseId,
    from,
    to,
    revision,
    summaryPage,
  ]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      if (kind === "suppliers")
        await api(
          `/api/suppliers${editingSupplier ? `/${editingSupplier.id}` : ""}`,
          {
            method: editingSupplier ? "PATCH" : "POST",
            body: JSON.stringify({
              code: values.get("code"),
              name: values.get("name"),
              contactName: values.get("contactName"),
              email: values.get("email"),
              phone: values.get("phone"),
              ...(editingSupplier
                ? {
                    isActive: values.get("active") === "on",
                    expectedUpdatedAt: editingSupplier.updatedAt,
                  }
                : {}),
            }),
          },
        );
      else
        await api(`/api/users${editingUser ? `/${editingUser.id}` : ""}`, {
          method: editingUser ? "PATCH" : "POST",
          body: JSON.stringify({
            username: values.get("username"),
            displayName: values.get("displayName"),
            role: values.get("role"),
            warehouseIds: assigned,
            ...(editingUser
              ? {
                  isActive: values.get("active") === "on",
                  expectedUpdatedAt: editingUser.updatedAt,
                  ...(values.get("password")
                    ? { password: values.get("password") }
                    : {}),
                }
              : { password: values.get("password") }),
          }),
        });
      setNotice("Kayıt kaydedildi.");
      setFormOpen(false);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }
  async function threshold(item: Stock) {
    const value = window.prompt(
      `${item.sku} · ${item.warehouse} minimum stok eşiği`,
      item.minimumStock,
    );
    if (value === null) return;
    setBusy(true);
    try {
      await api(`/api/thresholds/${item.warehouseId}/${item.productId}`, {
        method: "PUT",
        body: JSON.stringify({ minimumStock: value.trim().replace(",", ".") }),
      });
      setRevision((n) => n + 1);
      setNotice("Minimum stok eşiği kaydedildi.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }
  async function reconcile() {
    setBusy(true);
    try {
      const result = await api<{ consistent: boolean; items: unknown[] }>(
        "/api/reconciliation",
      );
      setNotice(
        result.consistent
          ? "Stok defteri ile bütün bakiyeler tutarlı."
          : `${result.items.length} uyumsuz kayıt bulundu. Otomatik düzeltme yapılmadı.`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const activityCsvQuery = new URLSearchParams({
    format: "csv",
    ...(warehouseId ? { warehouseId } : {}),
    ...(from ? { startDate: new Date(`${from}T00:00:00`).toISOString() } : {}),
    ...(to ? { endDate: new Date(`${to}T23:59:59.999`).toISOString() } : {}),
  });
  const title: Record<string, string> = {
    suppliers: "Tedarikçiler",
    users: "Kullanıcılar ve depo atamaları",
    reports: "Stok ve hareket raporları",
    audit: "Denetim kayıtları",
  };
  return (
    <section>
      <div className="page-header">
        <h1>{title[kind ?? ""]}</h1>
        {role === "ADMIN" && (kind === "suppliers" || kind === "users") && (
          <button
            className="primary-button"
            onClick={() => {
              setEditingSupplier(null);
              setEditingUser(null);
              setAssigned([]);
              setFormOpen(true);
            }}
          >
            Yeni {kind === "suppliers" ? "tedarikçi" : "kullanıcı"}
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
      {formOpen && (
        <form
          className="data-form"
          onSubmit={(e) => void save(e)}
          key={editingSupplier?.id ?? editingUser?.id ?? "new"}
        >
          {kind === "suppliers" ? (
            <>
              <h2>
                {editingSupplier ? "Tedarikçiyi düzenle" : "Yeni tedarikçi"}
              </h2>
              <label>
                Kod
                <input
                  name="code"
                  required
                  maxLength={48}
                  disabled={Boolean(editingSupplier)}
                  defaultValue={editingSupplier?.code}
                />
              </label>
              <label>
                Firma adı
                <input
                  name="name"
                  required
                  maxLength={160}
                  defaultValue={editingSupplier?.name}
                />
              </label>
              <label>
                İlgili kişi
                <input
                  name="contactName"
                  maxLength={120}
                  defaultValue={editingSupplier?.contactName ?? ""}
                />
              </label>
              <label>
                E-posta
                <input
                  type="email"
                  name="email"
                  maxLength={254}
                  defaultValue={editingSupplier?.email ?? ""}
                />
              </label>
              <label>
                Telefon
                <input
                  name="phone"
                  maxLength={40}
                  defaultValue={editingSupplier?.phone ?? ""}
                />
              </label>
              {editingSupplier && (
                <label className="checkbox-label">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={editingSupplier.isActive}
                  />
                  Aktif
                </label>
              )}
            </>
          ) : (
            <>
              <h2>{editingUser ? "Kullanıcıyı düzenle" : "Yeni kullanıcı"}</h2>
              <label>
                Kullanıcı adı
                <input
                  name="username"
                  required
                  disabled={Boolean(editingUser)}
                  defaultValue={editingUser?.username}
                  autoComplete="off"
                />
              </label>
              <label>
                Görünen ad
                <input
                  name="displayName"
                  required
                  maxLength={120}
                  defaultValue={editingUser?.displayName}
                />
              </label>
              {
                <label>
                  {editingUser ? "Yeni parola (isteğe bağlı)" : "İlk parola"}
                  <input
                    type="password"
                    name="password"
                    minLength={14}
                    maxLength={1024}
                    required={!editingUser}
                    autoComplete="new-password"
                  />
                </label>
              }
              <label>
                Rol
                <select
                  name="role"
                  defaultValue={editingUser?.role ?? "VIEWER"}
                >
                  {["VIEWER", "WAREHOUSE_MANAGER", "ADMIN"].map((r) => (
                    <option key={r} value={r}>
                      {names[r]}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Yetkili depolar</legend>
                {warehouses.map((w) => (
                  <label key={w.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={assigned.includes(w.id)}
                      onChange={(e) =>
                        setAssigned(
                          e.target.checked
                            ? [...assigned, w.id]
                            : assigned.filter((id) => id !== w.id),
                        )
                      }
                    />
                    {w.name}
                  </label>
                ))}
              </fieldset>
              {editingUser && (
                <>
                  <label className="checkbox-label">
                    <input
                      name="active"
                      type="checkbox"
                      defaultChecked={editingUser.isActive}
                    />
                    Aktif
                  </label>
                  <p className="help-note">
                    Değişiklik, kullanıcının açık oturumlarını kapatır.
                    {editingUser.id === userId
                      ? " Kendi hesabınızı değiştiriyorsunuz; tekrar giriş yapmanız gerekir."
                      : ""}
                  </p>
                </>
              )}
            </>
          )}
          <div className="form-actions">
            <button className="primary-button" disabled={busy}>
              Kaydet
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setFormOpen(false)}
            >
              Vazgeç
            </button>
          </div>
        </form>
      )}
      {(kind === "suppliers" || kind === "reports") && (
        <div className="filters">
          <label>
            Ara
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
          {kind === "reports" && (
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
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={lowOnly}
                  onChange={(e) => {
                    setLowOnly(e.target.checked);
                    setPage(1);
                  }}
                />
                Minimum stok altında
              </label>
              <a
                className="secondary-button link-button"
                href={`/api/reports/stock?${stockQuery}&format=csv`}
                download
              >
                Stok CSV indir
              </a>
              {role === "ADMIN" && (
                <button disabled={busy} onClick={() => void reconcile()}>
                  Defter/bakiye kontrolü
                </button>
              )}
            </>
          )}
        </div>
      )}
      {loading ? (
        <p role="status">Yükleniyor…</p>
      ) : (
        <div className="table-wrap">
          <table>
            {kind === "suppliers" && (
              <>
                <thead>
                  <tr>
                    <th>Kod</th>
                    <th>Firma</th>
                    <th>İlgili kişi</th>
                    <th>İletişim</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id}>
                      <td>{s.code}</td>
                      <td>{s.name}</td>
                      <td>{s.contactName ?? "—"}</td>
                      <td>
                        {s.email}
                        <br />
                        {s.phone}
                      </td>
                      <td>{s.isActive ? "Aktif" : "Pasif"}</td>
                      <td>
                        {role === "ADMIN" && (
                          <button
                            onClick={() => {
                              setEditingSupplier(s);
                              setFormOpen(true);
                            }}
                          >
                            Düzenle
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {kind === "users" && (
              <>
                <thead>
                  <tr>
                    <th>Kullanıcı adı</th>
                    <th>Ad</th>
                    <th>Rol</th>
                    <th>Depolar</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>{u.displayName}</td>
                      <td>{names[u.role]}</td>
                      <td>
                        {u.role === "ADMIN"
                          ? "Tümü"
                          : u.warehouseAssignments
                              .map(
                                (a) =>
                                  warehouses.find((w) => w.id === a.warehouseId)
                                    ?.name ?? a.warehouseId,
                              )
                              .join(", ") || "Atama yok"}
                      </td>
                      <td>{u.isActive ? "Aktif" : "Pasif"}</td>
                      <td>
                        <button
                          onClick={() => {
                            setEditingUser(u);
                            setAssigned(
                              u.warehouseAssignments.map((a) => a.warehouseId),
                            );
                            setFormOpen(true);
                          }}
                        >
                          Düzenle
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {kind === "reports" && (
              <>
                <thead>
                  <tr>
                    <th>Depo</th>
                    <th>SKU</th>
                    <th>Ürün</th>
                    <th>Birim</th>
                    <th>Mevcut</th>
                    <th>Minimum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {stocks.map((s) => (
                    <tr key={`${s.warehouseId}:${s.productId}`}>
                      <td>{s.warehouse}</td>
                      <td>{s.sku}</td>
                      <td>{s.name}</td>
                      <td>{names[s.unit]}</td>
                      <td>{s.quantity}</td>
                      <td>{s.minimumStock}</td>
                      <td>
                        {role === "ADMIN" && (
                          <button
                            disabled={busy}
                            onClick={() => void threshold(s)}
                          >
                            Eşik belirle
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {kind === "audit" && (
              <>
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Kullanıcı</th>
                    <th>İşlem</th>
                    <th>Kayıt</th>
                    <th>Ayrıntı</th>
                  </tr>
                </thead>
                <tbody>
                  {audits.map((a) => (
                    <tr key={a.id}>
                      <td>{new Date(a.createdAt).toLocaleString("tr-TR")}</td>
                      <td>{a.user.displayName}</td>
                      <td>{a.action}</td>
                      <td>
                        {a.relatedType}
                        <br />
                        {a.relatedId}
                      </td>
                      <td>
                        <details>
                          <summary>Değişiklik</summary>
                          <pre>{JSON.stringify(a.changeSummary, null, 2)}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
          {total === 0 && (
            <p className="state-message">Bu filtrelerde kayıt bulunamadı.</p>
          )}
        </div>
      )}
      <div className="pagination">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Önceki
        </button>
        <span>
          {page} / {Math.max(1, Math.ceil(total / 25))}
        </span>
        <button disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>
          Sonraki
        </button>
      </div>
      {kind === "reports" && (
        <>
          <h2>Depo özeti</h2>
          <p className="help-note">
            Pozitif bakiyeli ürünler, her depo ve ölçü birimi için ayrı
            gösterilir. Ürün arama filtresi bu özeti etkilemez.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Depo</th>
                  <th>Birim</th>
                  <th>Stoklu ürün</th>
                  <th>Toplam miktar</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s, i) => (
                  <tr key={i}>
                    <td>{s.warehouse}</td>
                    <td>{names[s.unit]}</td>
                    <td>{s.productCount}</td>
                    <td>{s.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button
              disabled={summaryPage <= 1}
              onClick={() => setSummaryPage(summaryPage - 1)}
            >
              Önceki depolar
            </button>
            <span>Özet sayfası {summaryPage}</span>
            <button
              disabled={summaries.length < 25}
              onClick={() => setSummaryPage(summaryPage + 1)}
            >
              Sonraki depolar
            </button>
          </div>
          <h2>Dönemsel hareket özeti</h2>
          <a
            className="secondary-button link-button"
            href={`/api/reports/activity?${activityCsvQuery}`}
            download
          >
            Hareket özeti CSV indir
          </a>
          <p className="help-note">
            Miktarlar depo, birim, yön ve hareket türüne göre ayrı hesaplanır.
            Farklı birimler toplanmaz.
          </p>
          <div className="filters">
            <label>
              Başlangıç
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Bitiş
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Depo</th>
                  <th>Birim</th>
                  <th>Yön</th>
                  <th>Tür</th>
                  <th>Miktar</th>
                  <th>Hareket sayısı</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a, i) => (
                  <tr key={i}>
                    <td>{a.warehouse}</td>
                    <td>{names[a.unit]}</td>
                    <td>{names[a.direction]}</td>
                    <td>{names[a.type]}</td>
                    <td>{a.quantity}</td>
                    <td>{a.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
