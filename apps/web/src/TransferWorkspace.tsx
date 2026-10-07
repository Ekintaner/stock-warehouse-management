import {
  useEffect,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

type Role = "ADMIN" | "WAREHOUSE_MANAGER" | "VIEWER";
type TransferStatus = "DRAFT" | "SHIPPED" | "RECEIVED" | "CANCELLED" | "RETURNED";
type Unit = "EACH" | "KILOGRAM" | "METER";

interface Warehouse {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  unit: Unit;
  isActive: boolean;
}

interface TransferLine {
  id: string;
  productId: string;
  unit: Unit;
  quantity: string;
  product: Product;
}

interface Transfer {
  id: string;
  transferNumber: string;
  sourceWarehouseId: string;
  targetWarehouseId: string;
  status: TransferStatus;
  returnOrigin: "SHIPPED" | "RECEIVED" | null;
  returnReason: string | null;
  description: string | null;
  updatedAt: string;
  createdAt: string;
  shippedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  returnedAt: string | null;
  sourceWarehouse: Warehouse;
  targetWarehouse: Warehouse;
  createdBy: { id: string; displayName: string };
  shippedBy: { id: string; displayName: string } | null;
  receivedBy: { id: string; displayName: string } | null;
  cancelledBy: { id: string; displayName: string } | null;
  returnedBy: { id: string; displayName: string } | null;
  lines: TransferLine[];
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface Props {
  path: string;
  role: Role;
  warehouseIds: string[];
  csrfToken: string;
  navigate: (event: MouseEvent<HTMLAnchorElement>, destination: string) => void;
  onSuccess: (message: string) => void;
}

const PAGE_SIZE = 25;

function unitLabel(unit: Unit): string {
  if (unit === "EACH") return "Adet";
  if (unit === "KILOGRAM") return "Kilogram";
  return "Metre";
}

function statusLabel(status: TransferStatus): string {
  switch (status) {
    case "DRAFT": return "Taslak";
    case "SHIPPED": return "Sevk edildi";
    case "RECEIVED": return "Teslim alındı";
    case "CANCELLED": return "İptal edildi";
    case "RETURNED": return "Geri döndü";
  }
}

function formatNumber(value: string): string {
  return value.replace(/\.?0+$/, "");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function transferNumber(value: Transfer): string {
  return `TR-${value.transferNumber.padStart(8, "0")}`;
}

function localErrorMessage(response: Response): Promise<string> {
  return response
    .json()
    .then((payload: unknown) => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "object" &&
        payload.error !== null &&
        "message" in payload.error &&
        typeof payload.error.message === "string"
      ) {
        return payload.error.message;
      }
      return "İstek tamamlanamadı. Tekrar deneyin.";
    })
    .catch(() => "İstek tamamlanamadı. Tekrar deneyin.");
}

async function api<T>(
  url: string,
  csrfToken: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (init.method && init.method !== "GET") {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new Error(await localErrorMessage(response));
  return (await response.json()) as T;
}

function Link({
  href,
  navigate,
  children,
  className,
}: {
  href: string;
  navigate: Props["navigate"];
  children: ReactNode;
  className?: string;
}) {
  return <a className={className} href={href} onClick={(event) => navigate(event, href)}>{children}</a>;
}

function ErrorMessage({ children }: { children: string }) {
  return <p className="error-banner" role="alert">{children}</p>;
}

function Loading() {
  return <p className="state-message" role="status">Yükleniyor…</p>;
}

function Empty({ children }: { children: string }) {
  return <p className="state-message">{children}</p>;
}

function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (value: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination" aria-label="Sayfalama">
      <span>{total} kayıt · Sayfa {page} / {pages}</span>
      <div>
        <button className="secondary-button" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Önceki</button>
        <button className="secondary-button" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Sonraki</button>
      </div>
    </div>
  );
}

function goTo(destination: string): void {
  window.history.pushState(null, "", destination);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function parseQuantity(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{1,15}(?:[,.]\d{1,3})?$/.test(trimmed)) return null;
  return trimmed.replace(",", ".");
}

function useWarehouses(csrfToken: string) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api<{ items: Warehouse[] }>("/api/transfer-warehouses", csrfToken)
      .then((result) => { if (!cancelled) setWarehouses(result.items); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Depolar yüklenemedi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [csrfToken]);
  return { warehouses, error, loading };
}

function TransferWorkspace(props: Props) {
  const { path, role, warehouseIds, csrfToken, navigate, onSuccess } = props;
  const detailMatch = path.match(/^\/transfers\/([^/]+)(?:\/(edit))?$/);
  if (path === "/transfers/new") {
    return <TransferForm {...props} />;
  }
  if (detailMatch) {
    return (
      <TransferDetail
        id={detailMatch[1]!}
        editing={detailMatch[2] === "edit"}
        role={role}
        warehouseIds={warehouseIds}
        csrfToken={csrfToken}
        navigate={navigate}
        onSuccess={onSuccess}
      />
    );
  }
  return <TransferList {...props} />;
}

function TransferList({ role, csrfToken, navigate }: Props) {
  const { warehouses, error: warehouseError } = useWarehouses(csrfToken);
  const [status, setStatus] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Transfer> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort: "createdAt",
      direction: "desc",
    });
    if (status) params.set("status", status);
    if (warehouseId) params.set("warehouseId", warehouseId);
    if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
    if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
    api<Page<Transfer>>(`/api/transfers?${params}`, csrfToken)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Transferler yüklenemedi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status, warehouseId, from, to, page, csrfToken]);

  return (
    <section>
      <header className="page-header">
        <div><h1>Transferler</h1><p>Depolar arasındaki sevk ve teslim kayıtları</p></div>
        {role !== "VIEWER" && <Link className="primary-button link-button" href="/transfers/new" navigate={navigate}>Transfer taslağı oluştur</Link>}
      </header>
      {warehouseError && <ErrorMessage>{warehouseError}</ErrorMessage>}
      <div className="stock-filter-bar" aria-label="Transfer filtreleri">
        <label>Durum
          <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
            <option value="">Tüm durumlar</option>
            <option value="DRAFT">Taslak</option><option value="SHIPPED">Sevk edildi</option>
            <option value="RECEIVED">Teslim alındı</option><option value="RETURNED">Geri döndü</option>
            <option value="CANCELLED">İptal edildi</option>
          </select>
        </label>
        <label>Kaynak veya hedef depo
          <select value={warehouseId} onChange={(event) => { setPage(1); setWarehouseId(event.target.value); }}>
            <option value="">Yetkili depoların tümü</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
        </label>
        <label>Başlangıç tarihi<input type="date" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value); }} /></label>
        <label>Bitiş tarihi<input type="date" value={to} onChange={(event) => { setPage(1); setTo(event.target.value); }} /></label>
      </div>
      {loading ? <Loading /> : error ? <ErrorMessage>{error}</ErrorMessage> : data?.items.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Belge no</th><th scope="col">Tarih</th><th scope="col">Kaynak depo</th><th scope="col">Hedef depo</th><th scope="col">Durum</th></tr></thead>
              <tbody>{data.items.map((item) => (
                <tr key={item.id}>
                  <td><Link href={`/transfers/${item.id}`} navigate={navigate}>{transferNumber(item)}</Link></td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{item.sourceWarehouse.code} · {item.sourceWarehouse.name}</td>
                  <td>{item.targetWarehouse.code} · {item.targetWarehouse.name}</td>
                  <td>{statusLabel(item.status)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      ) : <Empty>Bu ölçütlere uygun transfer yok.</Empty>}
    </section>
  );
}

interface DraftLine {
  product: Product;
  quantity: string;
}

function TransferForm({
  path,
  role,
  warehouseIds,
  csrfToken,
  navigate,
  onSuccess,
}: Props) {
  const editingMatch = path.match(/^\/transfers\/([^/]+)\/edit$/);
  const transferId = editingMatch?.[1];
  const editing = Boolean(transferId);
  const canWrite = role !== "VIEWER";
  const { warehouses, error: warehouseError, loading: warehousesLoading } = useWarehouses(csrfToken);
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [targetWarehouseId, setTargetWarehouseId] = useState("");
  const [description, setDescription] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [productChoice, setProductChoice] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [stockByProduct, setStockByProduct] = useState<Record<string, string>>({});
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing || !transferId) return;
    let cancelled = false;
    api<Transfer>(`/api/transfers/${transferId}`, csrfToken)
      .then((value) => {
        if (cancelled) return;
        setTransfer(value);
        setSourceWarehouseId(value.sourceWarehouseId);
        setTargetWarehouseId(value.targetWarehouseId);
        setDescription(value.description ?? "");
        setLines(value.lines.map((line) => ({
          product: line.product,
          quantity: formatNumber(line.quantity),
        })));
      })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Transfer yüklenemedi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [editing, transferId, csrfToken]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      page: "1", pageSize: "100", sort: "sku", direction: "asc", isActive: "true",
    });
    if (productQuery.trim()) params.set("q", productQuery.trim());
    api<Page<Product>>(`/api/products?${params}`, csrfToken)
      .then((result) => { if (!cancelled) setProducts(result.items); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Ürünler yüklenemedi."); });
    return () => { cancelled = true; };
  }, [productQuery, csrfToken]);

  useEffect(() => {
    if (!sourceWarehouseId || !lines.length) return;
    let cancelled = false;
    Promise.all(lines.map(async ({ product }) => {
      const params = new URLSearchParams({
        warehouseId: sourceWarehouseId,
        q: product.sku,
        page: "1",
        pageSize: "1",
      });
      const result = await api<Page<{ id: string; quantity: string }>>(`/api/stock?${params}`, csrfToken);
      return [product.id, result.items.find((item) => item.id === product.id)?.quantity ?? "0.000"] as const;
    }))
      .then((values) => { if (!cancelled) setStockByProduct(Object.fromEntries(values)); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Kaynak stok miktarı alınamadı."); });
    return () => { cancelled = true; };
  }, [sourceWarehouseId, lines, csrfToken]);

  function addProduct() {
    const product = products.find((item) => item.id === productChoice);
    if (!product || lines.some((line) => line.product.id === product.id)) return;
    setLines((current) => [...current, { product, quantity: "" }]);
    setProductChoice("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (sourceWarehouseId === targetWarehouseId) {
      setError("Kaynak ve hedef depolar farklı olmalıdır.");
      return;
    }
    if (!lines.length) {
      setError("Transfer taslağına en az bir ürün satırı ekleyin.");
      return;
    }
    const apiLines = lines.map((line) => ({
      productId: line.product.id,
      quantity: parseQuantity(line.quantity),
    }));
    if (apiLines.some((line) => line.quantity === null)) {
      setError("Miktarı pozitif bir sayı olarak, en fazla üç ondalık basamakla girin. Virgül kullanabilirsiniz.");
      return;
    }
    setSaving(true);
    try {
      const method = editing ? "PATCH" : "POST";
      const url = editing && transferId ? `/api/transfers/${transferId}` : "/api/transfers";
      const body = editing
        ? { description, lines: apiLines, expectedUpdatedAt: transfer?.updatedAt }
        : { sourceWarehouseId, targetWarehouseId, description, lines: apiLines };
      const saved = await api<Transfer>(url, csrfToken, { method, body: JSON.stringify(body) });
      goTo(`/transfers/${saved.id}`);
      onSuccess(editing ? "Transfer taslağı güncellendi." : "Transfer taslağı oluşturuldu.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transfer taslağı kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading />;
  if (editing && error && !transfer) return <ErrorMessage>{error}</ErrorMessage>;
  if (!canWrite) return <ErrorMessage>Bu işlem için yetkiniz yok.</ErrorMessage>;

  return (
    <section>
      <header className="page-header"><div><h1>{editing ? "Transfer taslağını düzenle" : "Yeni transfer taslağı"}</h1></div></header>
      {warehouseError && <ErrorMessage>{warehouseError}</ErrorMessage>}
      <form className="data-form stock-form" onSubmit={(event) => void submit(event)}>
        <label>Kaynak depo
          <select required value={sourceWarehouseId} disabled={editing || warehousesLoading} onChange={(event) => setSourceWarehouseId(event.target.value)}>
            <option value="">Kaynak depo seçin</option>
            {warehouses.filter((warehouse) => warehouse.isActive !== false && (role === "ADMIN" || warehouseIds.includes(warehouse.id))).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
        </label>
        <label>Hedef depo
          <select required value={targetWarehouseId} disabled={editing || warehousesLoading} onChange={(event) => setTargetWarehouseId(event.target.value)}>
            <option value="">Hedef depo seçin</option>
            {warehouses.filter((warehouse) => warehouse.id !== sourceWarehouseId && warehouse.isActive !== false).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
        </label>
        <label>Açıklama<textarea maxLength={1000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <fieldset className="stock-lines">
          <legend>Transfer ürünleri</legend>
          <div className="stock-product-picker">
            <label>Ürün ara<input value={productQuery} maxLength={120} onChange={(event) => setProductQuery(event.target.value)} placeholder="SKU veya ürün adı" /></label>
            <label>Ürün seçin
              <select value={productChoice} onChange={(event) => setProductChoice(event.target.value)}>
                <option value="">Ürün seçin</option>
                {products.filter((product) => !lines.some((line) => line.product.id === product.id)).map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={addProduct} disabled={!productChoice}>Satır ekle</button>
          </div>
          {lines.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Ürün</th><th scope="col">Birim</th><th scope="col">Kaynak stok</th><th scope="col">Miktar</th><th scope="col">İşlem</th></tr></thead>
                <tbody>{lines.map((line) => (
                  <tr key={line.product.id}>
                    <td>{line.product.sku} · {line.product.name}</td>
                    <td>{unitLabel(line.product.unit)}</td>
                    <td className="quantity-cell">{stockByProduct[line.product.id] ?? "Yükleniyor…"}</td>
                    <td><label className="quantity-input-label"><span className="visually-hidden">{line.product.name} transfer miktarı</span>
                      <input required inputMode="decimal" autoComplete="off" value={line.quantity}
                        onChange={(event) => setLines((current) => current.map((item) => item.product.id === line.product.id ? { ...item, quantity: event.target.value } : item))}
                        aria-label={`${line.product.name} transfer miktarı`} />
                    </label></td>
                    <td><button className="text-button" type="button" onClick={() => setLines((current) => current.filter((item) => item.product.id !== line.product.id))}>Satırı kaldır</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty>Henüz ürün satırı eklenmedi.</Empty>}
        </fieldset>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={saving || warehousesLoading}>{saving ? "Kaydediliyor…" : "Taslağı kaydet"}</button>
          <Link className="secondary-button link-button" href={editing && transferId ? `/transfers/${transferId}` : "/transfers"} navigate={navigate}>Vazgeç</Link>
        </div>
      </form>
    </section>
  );
}

interface PendingRequest {
  key: string;
  body: string;
}

function pendingRequest(transferId: string, action: string, body: string): PendingRequest {
  const storageKey = `transfer:${transferId}:${action}`;
  const existing = sessionStorage.getItem(storageKey);
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "key" in parsed &&
        typeof parsed.key === "string" &&
        "body" in parsed &&
        typeof parsed.body === "string"
      ) {
        return parsed as PendingRequest;
      }
    } catch {
      throw new Error("Önceki güvenli istek anahtarı okunamadı; yeni bir işlem göndermeyin.");
    }
    throw new Error("Önceki güvenli istek bilgisi geçersiz; yeni bir işlem göndermeyin.");
  }
  const intent = { key: crypto.randomUUID(), body };
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(intent));
  } catch {
    throw new Error("Güvenli tekrar deneme bilgisi saklanamadı; işlem gönderilmedi.");
  }
  return intent;
}

function TransferDetail({
  id,
  editing,
  role,
  warehouseIds,
  csrfToken,
  navigate,
  onSuccess,
}: {
  id: string;
  editing: boolean;
  role: Role;
  warehouseIds: string[];
  csrfToken: string;
  navigate: Props["navigate"];
  onSuccess: Props["onSuccess"];
}) {
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [returnReason, setReturnReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api<Transfer>(`/api/transfers/${id}`, csrfToken)
      .then((value) => { if (!cancelled) setTransfer(value); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Transfer yüklenemedi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, csrfToken]);

  if (loading) return <Loading />;
  if (error && !transfer) return <ErrorMessage>{error}</ErrorMessage>;
  if (!transfer) return <Empty>Transfer bulunamadı.</Empty>;
  const activeTransfer = transfer;
  if (editing) {
    if (transfer.status !== "DRAFT") return <ErrorMessage>Taslak olmayan transfer düzenlenemez.</ErrorMessage>;
    return <TransferForm path={`/transfers/${id}/edit`} role={role} warehouseIds={warehouseIds} csrfToken={csrfToken} navigate={navigate} onSuccess={onSuccess} />;
  }

  const isAdmin = role === "ADMIN";
  const canShip = transfer.status === "DRAFT" &&
    (isAdmin || (role === "WAREHOUSE_MANAGER" && warehouseIds.includes(transfer.sourceWarehouseId)));
  const canCancel = canShip;
  const canReceive = transfer.status === "SHIPPED" &&
    (isAdmin || (role === "WAREHOUSE_MANAGER" && warehouseIds.includes(transfer.targetWarehouseId)));
  const canReturn = transfer.status === "SHIPPED";

  async function runAction(
    action: "ship" | "receive" | "return" | "cancel",
    message: string,
    body: Record<string, string>,
  ) {
    if (!window.confirm(message)) return;
    setWorking(true);
    setError("");
    const requestBody = JSON.stringify({ ...body, expectedUpdatedAt: activeTransfer.updatedAt });
    try {
      const intent = pendingRequest(activeTransfer.id, action, requestBody);
      const result = await api<Transfer>(`/api/transfers/${activeTransfer.id}/${action}`, csrfToken, {
        method: "POST",
        headers: { "Idempotency-Key": intent.key },
        body: intent.body,
      });
      sessionStorage.removeItem(`transfer:${activeTransfer.id}:${action}`);
      setTransfer(result);
      onSuccess(message.split("\n")[0] ?? "Transfer güncellendi.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "İşlem sonucu alınamadı. Aynı güvenli istekle yeniden deneyin.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section>
      <header className="page-header">
        <div><h1>{transferNumber(transfer)}</h1><p>{statusLabel(transfer.status)}</p></div>
        <div className="header-actions">
          {canShip && <button className="primary-button" type="button" disabled={working} onClick={() => void runAction("ship", `Sevk özeti:\n${transfer.lines.map((line) => `${line.product.name}: ${line.quantity} ${unitLabel(line.unit)}\n`).join("")}Miktarlar kaynak stoktan düşecek.`, {})}>Sevk et</button>}
          {canReceive && <button className="primary-button" type="button" disabled={working} onClick={() => void runAction("receive", `Teslim almayı onaylıyor musunuz?\n${transfer.lines.map((line) => `${line.product.name}: ${line.quantity} ${unitLabel(line.unit)}\n`).join("")}Miktarlar hedef stoğa eklenecek.`, {})}>Teslim al</button>}
          {canReturn && isAdmin && <button className="secondary-button" type="button" disabled={working || returnReason.trim().length < 3} onClick={() => void runAction("return", `Geri dönüş özeti:\n${transfer.lines.map((line) => `${line.product.name}: ${line.quantity} ${unitLabel(line.unit)}\n`).join("")}Transfer yoldan geri alınacak ve miktarlar kaynak stoğa eklenecek.`, { reason: returnReason.trim() })}>Geri döndür</button>}
        </div>
      </header>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <dl className="details-grid">
        <div className="detail"><dt>Kaynak depo</dt><dd>{transfer.sourceWarehouse.code} · {transfer.sourceWarehouse.name}</dd></div>
        <div className="detail"><dt>Hedef depo</dt><dd>{transfer.targetWarehouse.code} · {transfer.targetWarehouse.name}</dd></div>
        <div className="detail"><dt>Oluşturan</dt><dd>{transfer.createdBy.displayName} · {formatDate(transfer.createdAt)}</dd></div>
        <div className="detail"><dt>Sevk eden</dt><dd>{transfer.shippedBy?.displayName ?? "—"} · {formatDate(transfer.shippedAt)}</dd></div>
        <div className="detail"><dt>Teslim alan</dt><dd>{transfer.receivedBy?.displayName ?? "—"} · {formatDate(transfer.receivedAt)}</dd></div>
        <div className="detail"><dt>İptal eden</dt><dd>{transfer.cancelledBy?.displayName ?? "—"} · {formatDate(transfer.cancelledAt)}</dd></div>
        <div className="detail"><dt>Geri dönüş</dt><dd>{transfer.returnedBy?.displayName ?? "—"} · {formatDate(transfer.returnedAt)}</dd></div>
        {transfer.returnOrigin && <div className="detail"><dt>Geri dönüş kaynağı</dt><dd>{transfer.returnOrigin === "SHIPPED" ? "Yoldaki transfer" : "Teslim alınmış transfer"}</dd></div>}
        <div className="detail"><dt>Durum</dt><dd>{statusLabel(transfer.status)}</dd></div>
        {transfer.description && <div className="detail"><dt>Açıklama</dt><dd>{transfer.description}</dd></div>}
        {transfer.returnReason && <div className="detail"><dt>Geri dönüş gerekçesi</dt><dd>{transfer.returnReason}</dd></div>}
      </dl>
      <div className="section-heading-row"><h2>Ürünler</h2></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">SKU</th><th scope="col">Ürün</th><th scope="col">Birim</th><th scope="col">Miktar</th></tr></thead>
          <tbody>{transfer.lines.map((line) => <tr key={line.id}><td>{line.product.sku}</td><td>{line.product.name}</td><td>{unitLabel(line.unit)}</td><td className="quantity-cell">{line.quantity}</td></tr>)}</tbody>
        </table>
      </div>
      {canReturn && isAdmin && (
        <label className="return-reason">Geri dönüş gerekçesi
          <textarea required maxLength={1000} rows={3} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} />
        </label>
      )}
      {canShip && (
        <div className="form-actions">
          {transfer.status === "DRAFT" && <Link className="secondary-button link-button" href={`/transfers/${transfer.id}/edit`} navigate={navigate}>Taslağı düzenle</Link>}
          {canCancel && <button className="text-button" type="button" disabled={working} onClick={() => void runAction("cancel", "Taslak iptal edilecek. Stok değişmez ve transfer geçmişte korunur.", {})}>Taslağı iptal et</button>}
        </div>
      )}
      <Link className="back-link" href="/transfers" navigate={navigate}>← Transfer listesine dön</Link>
    </section>
  );
}

export default TransferWorkspace;
