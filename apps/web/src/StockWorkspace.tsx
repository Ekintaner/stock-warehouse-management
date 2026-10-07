import {
  useEffect,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

type Role = "ADMIN" | "WAREHOUSE_MANAGER" | "VIEWER";
type DocumentType = "RECEIPT" | "ISSUE";
type DocumentStatus = "DRAFT" | "APPROVED" | "CANCELLED";
type Unit = "EACH" | "KILOGRAM" | "METER";

interface Warehouse {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  unit: Unit;
  isActive: boolean;
}

interface Supplier {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

interface StockLine {
  id: string;
  productId: string;
  unit: Unit;
  quantity: string;
  description: string | null;
  product: Product;
}

interface StockDocument {
  id: string;
  documentNumber: string;
  type: DocumentType;
  status: DocumentStatus;
  warehouseId: string;
  supplierId: string | null;
  reference: string | null;
  description: string | null;
  updatedAt: string;
  createdAt: string;
  approvedAt: string | null;
  cancelledAt: string | null;
  warehouse: Pick<Warehouse, "id" | "code" | "name">;
  supplier: Pick<Supplier, "id" | "code" | "name"> | null;
  createdBy: { id: string; displayName: string };
  approvedBy: { id: string; displayName: string } | null;
  cancelledBy: { id: string; displayName: string } | null;
  lines: StockLine[];
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
  csrfToken: string;
  navigate: (event: MouseEvent<HTMLAnchorElement>, destination: string) => void;
  onSuccess: (message: string) => void;
}

interface MovementItem {
  id: string;
  createdAt: string;
  direction: "IN" | "OUT";
  quantity: string;
  type: string;
  product: { id: string; sku: string; name: string };
  warehouse: Warehouse;
  createdBy: { displayName: string };
  document: {
    id: string;
    documentNumber: string;
    type: DocumentType;
    reference: string | null;
  } | null;
}

const PAGE_SIZE = 25;

function unitLabel(unit: Unit): string {
  if (unit === "EACH") return "Adet";
  if (unit === "KILOGRAM") return "Kilogram";
  return "Metre";
}

function documentTypeLabel(type: DocumentType): string {
  return type === "RECEIPT" ? "Stok girişi" : "Stok çıkışı";
}

function documentStatusLabel(status: DocumentStatus): string {
  if (status === "DRAFT") return "Taslak";
  if (status === "APPROVED") return "Onaylandı";
  return "İptal edildi";
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

function useWarehouses(csrfToken: string) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<Page<Warehouse>>(
      "/api/warehouses?page=1&pageSize=100&sort=code&direction=asc",
      csrfToken,
    )
      .then((result) => {
        if (!cancelled) setWarehouses(result.items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Depolar yüklenemedi.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [csrfToken]);
  return { warehouses, error, loading };
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
  return (
    <a className={className} href={href} onClick={(event) => navigate(event, href)}>
      {children}
    </a>
  );
}

function Loading() {
  return <p className="state-message" role="status">Yükleniyor…</p>;
}

function ErrorMessage({ children }: { children: string }) {
  return <p className="error-banner" role="alert">{children}</p>;
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

function StockWorkspace(props: Props) {
  const { path, role, csrfToken, navigate, onSuccess } = props;
  const canWrite = role !== "VIEWER";
  const documentMatch = path.match(/^\/stock-documents\/([^/]+)(?:\/(edit))?$/);
  const formMatch = path.match(/^\/stock\/(receipts|issues)\/new$/);
  const section = path.startsWith("/stock/receipts")
    ? "receipts"
    : path.startsWith("/stock/issues")
      ? "issues"
      : path.startsWith("/movements")
        ? "movements"
        : "stock";

  if (formMatch) {
    return (
      <DocumentForm
        documentId={documentMatch?.[1]}
        editing={documentMatch?.[2] === "edit"}
        type={formMatch[1] === "receipts" ? "RECEIPT" : "ISSUE"}
        role={role}
        csrfToken={csrfToken}
        navigate={navigate}
        onSuccess={onSuccess}
      />
    );
  }
  if (documentMatch) {
    return (
      <DocumentDetail
        id={documentMatch[1]!}
        editing={documentMatch[2] === "edit"}
        role={role}
        csrfToken={csrfToken}
        navigate={navigate}
        onSuccess={onSuccess}
      />
    );
  }
  if (section === "receipts" || section === "issues") {
    return (
      <DocumentsList
        type={section === "receipts" ? "RECEIPT" : "ISSUE"}
        canWrite={canWrite}
        csrfToken={csrfToken}
        navigate={navigate}
      />
    );
  }
  if (section === "movements") {
    return <MovementsPage csrfToken={csrfToken} />;
  }
  return <StockPage csrfToken={csrfToken} />;
}

function StockPage({ csrfToken }: { csrfToken: string }) {
  const { warehouses, error: warehouseError, loading: warehousesLoading } =
    useWarehouses(csrfToken);
  const visibleWarehouses = warehouses;
  const [warehouseId, setWarehouseId] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<{
    id: string;
    sku: string;
    name: string;
    unit: Unit;
    isActive: boolean;
    quantity: string;
    inTransitIncoming: string;
    inTransitOutgoing: string;
  }> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!warehouseId && visibleWarehouses[0]) {
      setWarehouseId(visibleWarehouses[0].id);
    }
  }, [warehouseId, visibleWarehouses]);

  useEffect(() => {
    if (!warehouseId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      warehouseId,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort: "sku",
      direction: "asc",
    });
    if (q.trim()) params.set("q", q.trim());
    api<Page<{
      id: string;
      sku: string;
      name: string;
      unit: Unit;
      isActive: boolean;
      quantity: string;
      inTransitIncoming: string;
      inTransitOutgoing: string;
    }>>(`/api/stock?${params}`, csrfToken)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Stok bilgisi alınamadı.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [warehouseId, q, page, csrfToken]);

  return (
    <section>
      <header className="page-header">
        <div><h1>Stok</h1><p>Depo bazında güncel miktarlar</p></div>
      </header>
      {warehouseError && <ErrorMessage>{warehouseError}</ErrorMessage>}
      <div className="stock-filter-bar">
        <label>
          Depo
          <select
            value={warehouseId}
            onChange={(event) => {
              setPage(1);
              setWarehouseId(event.target.value);
            }}
            disabled={warehousesLoading}
          >
            <option value="">Depo seçin</option>
            {visibleWarehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}{warehouse.isActive ? "" : " (Pasif)"}</option>
            ))}
          </select>
        </label>
        <label>
          Ürün ara
          <input
            value={q}
            maxLength={120}
            onChange={(event) => {
              setPage(1);
              setQ(event.target.value);
            }}
            placeholder="SKU veya ürün adı"
          />
        </label>
      </div>
      {loading ? <Loading /> : error ? <ErrorMessage>{error}</ErrorMessage> : !warehouseId ? (
        <Empty>Görüntülenebilecek aktif depo bulunamadı.</Empty>
      ) : data?.items.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">SKU</th><th scope="col">Ürün</th><th scope="col">Birim</th><th scope="col">Stok</th><th scope="col">Yoldaki giriş</th><th scope="col">Yoldaki çıkış</th><th scope="col">Durum</th></tr></thead>
              <tbody>{data.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.sku}</td><td>{item.name}</td><td>{unitLabel(item.unit)}</td>
                  <td className="quantity-cell">{item.quantity}</td>
                  <td className="quantity-cell">{item.inTransitIncoming}</td>
                  <td className="quantity-cell">{item.inTransitOutgoing}</td>
                  <td>{item.isActive ? "Aktif" : "Pasif"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      ) : !loading ? <Empty>Bu aramayla eşleşen ürün yok.</Empty> : null}
    </section>
  );
}

function DocumentsList({
  type,
  canWrite,
  csrfToken,
  navigate,
}: {
  type: DocumentType;
  canWrite: boolean;
  csrfToken: string;
  navigate: Props["navigate"];
}) {
  const { warehouses, error: warehouseError } = useWarehouses(csrfToken);
  const [status, setStatus] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<StockDocument> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      type,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort: "createdAt",
      direction: "desc",
    });
    if (status) params.set("status", status);
    if (warehouseId) params.set("warehouseId", warehouseId);
    if (q.trim()) params.set("q", q.trim());
    api<Page<StockDocument>>(`/api/stock-documents?${params}`, csrfToken)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Belgeler yüklenemedi.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, status, warehouseId, q, page, csrfToken]);

  const base = type === "RECEIPT" ? "/stock/receipts" : "/stock/issues";
  return (
    <section>
      <header className="page-header">
        <div><h1>{documentTypeLabel(type)} belgeleri</h1></div>
        {canWrite && <Link className="primary-button link-button" href={`${base}/new`} navigate={navigate}>Taslak oluştur</Link>}
      </header>
      {warehouseError && <ErrorMessage>{warehouseError}</ErrorMessage>}
      <section className="stock-filter-bar" aria-label="Belge filtreleri">
        <label>
          Depo
          <select value={warehouseId} onChange={(event) => { setPage(1); setWarehouseId(event.target.value); }}>
            <option value="">Yetkili tüm depolar</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
        </label>
        <label>
          Durum
          <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
            <option value="">Tüm durumlar</option><option value="DRAFT">Taslak</option>
            <option value="APPROVED">Onaylandı</option><option value="CANCELLED">İptal edildi</option>
          </select>
        </label>
        <label>
          Referans veya açıklama
          <input value={q} maxLength={120} onChange={(event) => { setPage(1); setQ(event.target.value); }} />
        </label>
      </section>
      {loading ? <Loading /> : error ? <ErrorMessage>{error}</ErrorMessage> : data?.items.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Belge no</th><th scope="col">Tarih</th><th scope="col">Depo</th><th scope="col">Referans</th><th scope="col">Satır</th><th scope="col">Durum</th></tr></thead>
              <tbody>{data.items.map((item) => (
                <tr key={item.id}>
                  <td><Link href={`/stock-documents/${item.id}`} navigate={navigate}>{formatDocumentNumber(item)}</Link></td>
                  <td>{formatDate(item.createdAt)}</td><td>{item.warehouse.code} · {item.warehouse.name}</td>
                  <td>{item.reference ?? "—"}</td>
                  <td>{(item as StockDocument & { _count?: { lines: number } })._count?.lines ?? "—"}</td>
                  <td>{documentStatusLabel(item.status)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      ) : <Empty>Bu ölçütlere uygun belge yok.</Empty>}
    </section>
  );
}

function formatDocumentNumber(document: Pick<StockDocument, "documentNumber" | "type">): string {
  const prefix = document.type === "RECEIPT" ? "GI" : "GC";
  return `${prefix}-${document.documentNumber.padStart(8, "0")}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

interface DraftLine {
  productId: string;
  quantity: string;
  product: Product;
}

function toApiQuantity(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{1,15}(?:[,.]\d{1,3})?$/.test(trimmed)) return null;
  return trimmed.replace(",", ".");
}

function DocumentForm({
  documentId,
  editing,
  type,
  role,
  csrfToken,
  navigate,
  onSuccess,
}: {
  documentId?: string;
  editing: boolean;
  type: DocumentType;
  role: Role;
  csrfToken: string;
  navigate: Props["navigate"];
  onSuccess: Props["onSuccess"];
}) {
  const canWrite = role !== "VIEWER";
  const { warehouses, error: warehouseError, loading: warehousesLoading } =
    useWarehouses(csrfToken);
  const [warehouseId, setWarehouseId] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [productChoice, setProductChoice] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [document, setDocument] = useState<StockDocument | null>(null);
  const [stockByProduct, setStockByProduct] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing || !documentId) return;
    let cancelled = false;
    setLoading(true);
    api<StockDocument>(`/api/stock-documents/${documentId}`, csrfToken)
      .then((value) => {
        if (cancelled) return;
        setDocument(value);
        setWarehouseId(value.warehouseId);
        setReference(value.reference ?? "");
        setDescription(value.description ?? "");
        setSupplierId(value.supplierId ?? "");
        setLines(value.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity.replace(/\.?0+$/, ""),
          product: line.product,
        })));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Belge yüklenemedi.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editing, documentId, csrfToken]);

  useEffect(() => {
    if (editing || warehouseId || !warehouses.length) return;
    const active = warehouses.find((warehouse) => warehouse.isActive);
    if (active) setWarehouseId(active.id);
  }, [editing, warehouseId, warehouses]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      page: "1",
      pageSize: "50",
      sort: "sku",
      direction: "asc",
      isActive: "true",
    });
    if (productQuery.trim()) params.set("q", productQuery.trim());
    api<Page<Product>>(`/api/products?${params}`, csrfToken)
      .then((result) => {
        if (!cancelled) setProducts(result.items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Ürünler yüklenemedi.");
      });
    return () => {
      cancelled = true;
    };
  }, [productQuery, csrfToken]);

  useEffect(() => {
    if (type !== "RECEIPT") return;
    let cancelled = false;
    api<Page<Supplier>>("/api/suppliers?isActive=true&page=1&pageSize=100", csrfToken)
      .then((result) => {
        if (!cancelled) setSuppliers(result.items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Tedarikçiler yüklenemedi.");
      });
    return () => {
      cancelled = true;
    };
  }, [type, csrfToken]);

  useEffect(() => {
    if (type !== "ISSUE" || !warehouseId || !lines.length) return;
    let cancelled = false;
    Promise.all(
      lines.map(async (line) => {
        const params = new URLSearchParams({
          warehouseId,
          q: line.product.sku,
          page: "1",
          pageSize: "1",
        });
        const result = await api<Page<{ id: string; quantity: string }>>(
          `/api/stock?${params}`,
          csrfToken,
        );
        return [line.productId, result.items[0]?.quantity ?? "0.000"] as const;
      }),
    )
      .then((values) => {
        if (!cancelled) setStockByProduct(Object.fromEntries(values));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Mevcut stok alınamadı.");
      });
    return () => {
      cancelled = true;
    };
  }, [type, warehouseId, lines, csrfToken]);

  function addProduct() {
    const product = products.find((item) => item.id === productChoice);
    if (!product || lines.some((line) => line.productId === product.id)) return;
    setLines((current) => [...current, { productId: product.id, quantity: "", product }]);
    setProductChoice("");
  }

  function updateQuantity(productId: string, quantity: string) {
    setLines((current) => current.map((line) =>
      line.productId === productId ? { ...line, quantity } : line,
    ));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!lines.length) {
      setError("Taslak için en az bir ürün satırı ekleyin.");
      return;
    }
    const apiLines = lines.map((line) => ({
      productId: line.productId,
      quantity: toApiQuantity(line.quantity),
    }));
    if (apiLines.some((line) => line.quantity === null)) {
      setError("Miktarı pozitif bir sayı olarak, en fazla üç ondalık basamakla girin. Virgül kullanabilirsiniz.");
      return;
    }
    setSaving(true);
    try {
      const method = editing ? "PATCH" : "POST";
      const url = editing && documentId
        ? `/api/stock-documents/${documentId}`
        : "/api/stock-documents";
      const body = editing
        ? {
            reference,
            description,
            supplierId: supplierId || null,
            lines: apiLines,
            expectedUpdatedAt: document?.updatedAt,
          }
        : {
            type,
            warehouseId,
            reference,
            description,
            supplierId: supplierId || null,
            lines: apiLines,
          };
      const saved = await api<StockDocument>(url, csrfToken, {
        method,
        body: JSON.stringify(body),
      });
      goTo(`/stock-documents/${saved.id}`);
      onSuccess(editing ? "Taslak belge güncellendi." : "Taslak belge oluşturuldu.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Belge kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading />;
  if (editing && error && !document) return <ErrorMessage>{error}</ErrorMessage>;
  if (!canWrite) return <ErrorMessage>Bu işlem için yetkiniz yok.</ErrorMessage>;

  return (
    <section>
      <header className="page-header">
        <div><h1>{editing ? "Taslağı düzenle" : `Yeni ${documentTypeLabel(type).toLocaleLowerCase("tr-TR")} taslağı`}</h1></div>
      </header>
      {warehouseError && <ErrorMessage>{warehouseError}</ErrorMessage>}
      <form className="data-form stock-form" onSubmit={(event) => void submit(event)}>
        {!editing ? (
          <label>
            Depo
            <select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} disabled={warehousesLoading}>
              <option value="">Depo seçin</option>
              {warehouses.filter((warehouse) => warehouse.isActive).map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <label>Depo<input value={document?.warehouse.name ?? ""} readOnly /></label>
        )}
        <label>Belge referansı<input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        {type === "RECEIPT" && (
          <label>
            Tedarikçi
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">Tedarikçi seçilmedi</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}
            </select>
          </label>
        )}
        <label>Açıklama<textarea maxLength={1000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <fieldset className="stock-lines">
          <legend>Ürün satırları</legend>
          <div className="stock-product-picker">
            <label>
              Ürün ara
              <input value={productQuery} maxLength={120} onChange={(event) => setProductQuery(event.target.value)} placeholder="SKU veya ürün adı" />
            </label>
            <label>
              Ürün seçin
              <select value={productChoice} onChange={(event) => setProductChoice(event.target.value)}>
                <option value="">Ürün seçin</option>
                {products.filter((product) => !lines.some((line) => line.productId === product.id)).map((product) => (
                  <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>
                ))}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={addProduct} disabled={!productChoice}>Satır ekle</button>
          </div>
          {lines.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Ürün</th><th scope="col">Birim</th>{type === "ISSUE" && <th scope="col">Mevcut stok</th>}<th scope="col">Miktar</th><th scope="col">İşlem</th></tr></thead>
                <tbody>{lines.map((line) => (
                  <tr key={line.productId}>
                    <td>{line.product.sku} · {line.product.name}</td>
                    <td>{unitLabel(line.product.unit)}</td>
                    {type === "ISSUE" && <td className="quantity-cell">{stockByProduct[line.productId] ?? "Yükleniyor…"}</td>}
                    <td>
                      <label className="quantity-input-label">
                        <span className="visually-hidden">{line.product.name} miktarı</span>
                        <input
                          required
                          inputMode="decimal"
                          autoComplete="off"
                          value={line.quantity}
                          onChange={(event) => updateQuantity(line.productId, event.target.value)}
                          aria-label={`${line.product.name} miktarı`}
                        />
                      </label>
                    </td>
                    <td><button className="text-button" type="button" onClick={() => setLines((current) => current.filter((item) => item.productId !== line.productId))}>Satırı kaldır</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty>Henüz ürün satırı eklenmedi.</Empty>}
        </fieldset>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={saving || warehousesLoading}>{saving ? "Taslak kaydediliyor…" : "Taslağı kaydet"}</button>
          <Link className="secondary-button link-button" href={editing && documentId ? `/stock-documents/${documentId}` : type === "RECEIPT" ? "/stock/receipts" : "/stock/issues"} navigate={navigate}>Vazgeç</Link>
        </div>
      </form>
    </section>
  );
}

function DocumentDetail({
  id,
  editing,
  role,
  csrfToken,
  navigate,
  onSuccess,
}: {
  id: string;
  editing: boolean;
  role: Role;
  csrfToken: string;
  navigate: Props["navigate"];
  onSuccess: Props["onSuccess"];
}) {
  const [document, setDocument] = useState<StockDocument | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const canWrite = role !== "VIEWER";
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api<StockDocument>(`/api/stock-documents/${id}`, csrfToken)
      .then((value) => { if (!cancelled) setDocument(value); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Belge yüklenemedi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, csrfToken]);

  async function cancelDraft() {
    if (!document || !window.confirm("Taslak iptal edilecek. Stok miktarları değişmez ve belge geçmişte korunur. Devam edilsin mi?")) return;
    setWorking(true);
    setError("");
    try {
      const updated = await api<StockDocument>(
        `/api/stock-documents/${document.id}/cancel`,
        csrfToken,
        {
          method: "POST",
          body: JSON.stringify({ expectedUpdatedAt: document.updatedAt }),
        },
      );
      setDocument(updated);
      onSuccess("Taslak belge iptal edildi; stok miktarı değişmedi.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Taslak iptal edilemedi.");
    } finally {
      setWorking(false);
    }
  }

  async function approveDraft() {
    if (!document) return;
    const summary = document.lines
      .map((line) => `• ${line.product.sku} — ${line.quantity} ${unitLabel(line.unit)}`)
      .join("\n");
    const message = `${documentTypeLabel(document.type)} ${formatDocumentNumber(document)} onaylanacak.\nDepo: ${document.warehouse.name}\n\n${summary}\n\nStok miktarları değiştirilecek. Onaylıyor musunuz?`;
    if (!window.confirm(message)) return;
    const storageKey = `stock-approval:${document.id}`;
    let key = sessionStorage.getItem(storageKey);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
    }
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/stock-documents/${document.id}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ expectedUpdatedAt: document.updatedAt }),
      });
      if (!response.ok) {
        sessionStorage.removeItem(storageKey);
        throw new Error(await localErrorMessage(response));
      }
      sessionStorage.removeItem(storageKey);
      const updated = (await response.json()) as StockDocument;
      setDocument(updated);
      onSuccess("Belge onaylandı ve stok hareketi kaydedildi.");
    } catch (cause) {
      setError(cause instanceof Error
        ? `${cause.message} Yanıt alınamadıysa aynı güvenli anahtarla tekrar deneyebilirsiniz.`
        : "Onay sonucu alınamadı. Aynı güvenli anahtarla tekrar deneyin.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <Loading />;
  if (error && !document) return <ErrorMessage>{error}</ErrorMessage>;
  if (!document) return <Empty>Belge bulunamadı.</Empty>;
  if (editing && document.status === "DRAFT") {
    return (
      <DocumentForm
        documentId={id}
        editing
        type={document.type}
        role={role}
        csrfToken={csrfToken}
        navigate={navigate}
        onSuccess={onSuccess}
      />
    );
  }
  const listPath = document.type === "RECEIPT" ? "/stock/receipts" : "/stock/issues";
  return (
    <section>
      <header className="page-header">
        <div>
          <h1>{documentTypeLabel(document.type)} {formatDocumentNumber(document)}</h1>
          <p>{documentStatusLabel(document.status)}</p>
        </div>
        {canWrite && document.status === "DRAFT" && (
          <div className="header-actions">
            <Link className="secondary-button link-button" href={`/stock-documents/${id}/edit`} navigate={navigate}>Düzenle</Link>
            <button className="secondary-button" type="button" onClick={() => void cancelDraft()} disabled={working}>Taslağı iptal et</button>
            <button className="primary-button" type="button" onClick={() => void approveDraft()} disabled={working}>{working ? "Onaylanıyor…" : "Belgeyi onayla"}</button>
          </div>
        )}
      </header>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <dl className="details-grid">
        <Detail label="Depo" value={`${document.warehouse.code} · ${document.warehouse.name}`} />
        <Detail label="Belge referansı" value={document.reference ?? "—"} />
        <Detail label="Oluşturulma" value={formatDate(document.createdAt)} />
        <Detail label="Oluşturan" value={document.createdBy.displayName} />
        <Detail label="Tedarikçi" value={document.supplier?.name ?? "—"} />
        <Detail label="Açıklama" value={document.description ?? "—"} />
        {document.approvedAt && <Detail label="Onaylanma" value={`${formatDate(document.approvedAt)} · ${document.approvedBy?.displayName ?? ""}`} />}
        {document.cancelledAt && <Detail label="İptal" value={`${formatDate(document.cancelledAt)} · ${document.cancelledBy?.displayName ?? ""}`} />}
      </dl>
      <h2>Ürün satırları</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">SKU</th><th scope="col">Ürün</th><th scope="col">Birim</th><th scope="col">Miktar</th><th scope="col">Satır açıklaması</th></tr></thead>
          <tbody>{document.lines.map((line) => (
            <tr key={line.id}><td>{line.product.sku}</td><td>{line.product.name}</td><td>{unitLabel(line.unit)}</td><td className="quantity-cell">{line.quantity}</td><td>{line.description ?? "—"}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <Link className="back-link" href={listPath} navigate={navigate}>← Belge listesine dön</Link>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="detail"><dt>{label}</dt><dd>{value}</dd></div>;
}

function MovementsPage({ csrfToken }: { csrfToken: string }) {
  const { warehouses, error: warehouseError } = useWarehouses(csrfToken);
  const [warehouseId, setWarehouseId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [productId, setProductId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [direction, setDirection] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<MovementItem> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: "1", pageSize: "50", isActive: "true", sort: "sku" });
    if (productQuery.trim()) params.set("q", productQuery.trim());
    api<Page<Product>>(`/api/products?${params}`, csrfToken)
      .then((result) => { if (!cancelled) setProducts(result.items); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Ürünler yüklenemedi."); });
    return () => { cancelled = true; };
  }, [productQuery, csrfToken]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), directionOrder: "desc" });
    if (warehouseId) params.set("warehouseId", warehouseId);
    if (productId) params.set("productId", productId);
    if (direction) params.set("direction", direction);
    if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
    if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
    api<Page<MovementItem>>(`/api/stock-movements?${params}`, csrfToken)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Stok hareketleri yüklenemedi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, warehouseId, productId, direction, from, to, csrfToken]);

  return (
    <section>
      <header className="page-header"><div><h1>Hareketler</h1><p>Stok giriş ve çıkış geçmişi</p></div></header>
      {warehouseError && <ErrorMessage>{warehouseError}</ErrorMessage>}
      <div className="stock-filter-bar movement-filters">
        <label>Depo<select value={warehouseId} onChange={(event) => { setPage(1); setWarehouseId(event.target.value); }}><option value="">Yetkili tüm depolar</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
        <label>Ürün ara<input value={productQuery} maxLength={120} onChange={(event) => { setPage(1); setProductQuery(event.target.value); setProductId(""); }} /></label>
        <label>Ürün<select value={productId} onChange={(event) => { setPage(1); setProductId(event.target.value); }}><option value="">Tüm ürünler</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></label>
        <label>Yön<select value={direction} onChange={(event) => { setPage(1); setDirection(event.target.value); }}><option value="">Tümü</option><option value="IN">Giriş</option><option value="OUT">Çıkış</option></select></label>
        <label>Başlangıç<input type="date" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value); }} /></label>
        <label>Bitiş<input type="date" value={to} onChange={(event) => { setPage(1); setTo(event.target.value); }} /></label>
      </div>
      {loading ? <Loading /> : error ? <ErrorMessage>{error}</ErrorMessage> : data?.items.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Tarih</th><th scope="col">Belge</th><th scope="col">Ürün</th><th scope="col">Depo</th><th scope="col">Yön</th><th scope="col">Miktar</th><th scope="col">İşlem yapan</th></tr></thead>
              <tbody>{data.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{item.document ? `${item.document.type === "RECEIPT" ? "GI" : "GC"}-${item.document.documentNumber.padStart(8, "0")}${item.document.reference ? ` · ${item.document.reference}` : ""}` : "—"}</td>
                  <td>{item.product.sku} · {item.product.name}</td>
                  <td>{item.warehouse.code} · {item.warehouse.name}</td>
                  <td>{item.direction === "IN" ? "Giriş" : "Çıkış"}</td>
                  <td className="quantity-cell">{item.quantity}</td>
                  <td>{item.createdBy.displayName}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      ) : <Empty>Bu ölçütlere uygun stok hareketi yok.</Empty>}
    </section>
  );
}

export default StockWorkspace;
