import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import StockWorkspace from "./StockWorkspace.js";
import TransferWorkspace from "./TransferWorkspace.js";

interface User {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "WAREHOUSE_MANAGER" | "VIEWER";
  warehouseIds: string[];
}

interface Session {
  user: User;
  csrfToken: string;
}

interface Category {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
}

interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string;
  category: Pick<Category, "id" | "code" | "name">;
  unit: "EACH" | "KILOGRAM" | "METER";
  isActive: boolean;
  updatedAt: string;
}

interface Location {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
  locations?: Location[];
  _count?: { locations: number };
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface Props {
  session: Session;
  onLogout: () => Promise<void>;
  loggingOut: boolean;
}

const PAGE_SIZE = 25;

function roleLabel(role: User["role"]): string {
  if (role === "ADMIN") return "Yönetici";
  if (role === "WAREHOUSE_MANAGER") return "Depo sorumlusu";
  return "Görüntüleme";
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
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
  } catch {
    return "İstek tamamlanamadı. Tekrar deneyin.";
  }
  return "İstek tamamlanamadı. Tekrar deneyin.";
}

function statusLabel(active: boolean): string {
  return active ? "Aktif" : "Pasif";
}

function unitLabel(unit: Product["unit"]): string {
  if (unit === "EACH") return "Adet";
  if (unit === "KILOGRAM") return "Kilogram";
  return "Metre";
}

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function CatalogApp({ session, onLogout, loggingOut }: Props) {
  const [path, setPath] = useState(window.location.pathname);
  const [banner, setBanner] = useState("");
  const canManage = session.user.role === "ADMIN";

  useEffect(() => {
    function handlePopState() {
      setPath(window.location.pathname);
      setBanner("");
    }
    window.addEventListener("popstate", handlePopState);
    if (window.location.pathname === "/") {
      window.history.replaceState(null, "", "/products");
      setPath("/products");
    }
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(event: MouseEvent<HTMLAnchorElement>, destination: string) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (destination !== path) {
      window.history.pushState(null, "", destination);
      setPath(destination);
      setBanner("");
    }
  }

  const page = useMemo(() => {
    if (
      path === "/stock" ||
      path.startsWith("/stock/") ||
      path.startsWith("/stock-documents/") ||
      path.startsWith("/movements") ||
      path.startsWith("/transfers")
    ) {
      return "stock";
    }
    if (path.startsWith("/categories")) {
      return "categories";
    }
    if (path.startsWith("/warehouses")) {
      return "warehouses";
    }
    return "products";
  }, [path]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/products" onClick={(event) => navigate(event, "/products")}>
          Stok ve Depo
        </a>
        <nav aria-label="Ana gezinme" className="main-navigation">
          <a
            className={page === "products" ? "nav-link selected" : "nav-link"}
            href="/products"
            aria-current={page === "products" ? "page" : undefined}
            onClick={(event) => navigate(event, "/products")}
          >
            Ürünler
          </a>
          <a
            className={page === "categories" ? "nav-link selected" : "nav-link"}
            href="/categories"
            aria-current={page === "categories" ? "page" : undefined}
            onClick={(event) => navigate(event, "/categories")}
          >
            Kategoriler
          </a>
          <a
            className={page === "warehouses" ? "nav-link selected" : "nav-link"}
            href="/warehouses"
            aria-current={page === "warehouses" ? "page" : undefined}
            onClick={(event) => navigate(event, "/warehouses")}
          >
            Depolar
          </a>
          <a
            className={page === "stock" && path === "/stock" ? "nav-link selected" : "nav-link"}
            href="/stock"
            aria-current={page === "stock" && path === "/stock" ? "page" : undefined}
            onClick={(event) => navigate(event, "/stock")}
          >
            Stok
          </a>
          <a
            className={page === "stock" && path.startsWith("/stock/receipts") ? "nav-link selected" : "nav-link"}
            href="/stock/receipts"
            aria-current={page === "stock" && path.startsWith("/stock/receipts") ? "page" : undefined}
            onClick={(event) => navigate(event, "/stock/receipts")}
          >
            Stok Girişleri
          </a>
          <a
            className={page === "stock" && path.startsWith("/stock/issues") ? "nav-link selected" : "nav-link"}
            href="/stock/issues"
            aria-current={page === "stock" && path.startsWith("/stock/issues") ? "page" : undefined}
            onClick={(event) => navigate(event, "/stock/issues")}
          >
            Stok Çıkışları
          </a>
          <a
            className={page === "stock" && path.startsWith("/movements") ? "nav-link selected" : "nav-link"}
            href="/movements"
            aria-current={page === "stock" && path.startsWith("/movements") ? "page" : undefined}
            onClick={(event) => navigate(event, "/movements")}
          >
            Hareketler
          </a>
          <a
            className={page === "stock" && path.startsWith("/transfers") ? "nav-link selected" : "nav-link"}
            href="/transfers"
            aria-current={page === "stock" && path.startsWith("/transfers") ? "page" : undefined}
            onClick={(event) => navigate(event, "/transfers")}
          >
            Transferler
          </a>
        </nav>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="identity">
            <strong>{session.user.displayName}</strong>
            <span>{roleLabel(session.user.role)}</span>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() => void onLogout()}
            disabled={loggingOut}
          >
            {loggingOut ? "Çıkış yapılıyor…" : "Çıkış"}
          </button>
        </header>
        <main className="content" id="main-content">
          {banner && <p className="success-banner" role="status">{banner}</p>}
          {page === "products" && (
            <ProductsPage
              path={path}
              navigate={navigate}
              canManage={canManage}
              csrfToken={session.csrfToken}
              onSuccess={setBanner}
            />
          )}
          {page === "categories" && (
            <CategoriesPage
              path={path}
              navigate={navigate}
              canManage={canManage}
              csrfToken={session.csrfToken}
              onSuccess={setBanner}
            />
          )}
          {page === "warehouses" && (
            <WarehousesPage
              path={path}
              navigate={navigate}
              canManage={canManage}
              csrfToken={session.csrfToken}
              onSuccess={setBanner}
            />
          )}
          {page === "stock" && (
            path.startsWith("/transfers") ? (
              <TransferWorkspace
                path={path}
                role={session.user.role}
                warehouseIds={session.user.warehouseIds}
                csrfToken={session.csrfToken}
                navigate={navigate}
                onSuccess={setBanner}
              />
            ) : (
              <StockWorkspace
                path={path}
                role={session.user.role}
                csrfToken={session.csrfToken}
                navigate={navigate}
                onSuccess={setBanner}
              />
            )
          )}
        </main>
      </div>
    </div>
  );
}

interface PageProps {
  path: string;
  navigate: (event: MouseEvent<HTMLAnchorElement>, destination: string) => void;
  canManage: boolean;
  csrfToken: string;
  onSuccess: (message: string) => void;
}

async function api<T>(
  url: string,
  csrfToken: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (init.method && init.method !== "GET") {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function allCategories(csrfToken: string): Promise<Category[]> {
  const pageSize = 100;
  const first = await api<Page<Category>>(
    `/api/categories?page=1&pageSize=${pageSize}&sort=name&direction=asc`,
    csrfToken,
  );
  const remaining = await Promise.all(
    Array.from(
      { length: Math.ceil(first.total / pageSize) - 1 },
      (_, index) =>
        api<Page<Category>>(
          `/api/categories?page=${index + 2}&pageSize=${pageSize}&sort=name&direction=asc`,
          csrfToken,
        ),
    ),
  );
  return [first, ...remaining].flatMap((page) => page.items);
}

function Anchor({
  href,
  navigate,
  children,
  className,
}: {
  href: string;
  navigate: PageProps["navigate"];
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => navigate(event, href)}
    >
      {children}
    </a>
  );
}

function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function Loading() {
  return <p className="state-message" role="status">Yükleniyor…</p>;
}

function LoadError({ message }: { message: string }) {
  return <p className="error-banner" role="alert">{message}</p>;
}

function Empty({ children }: { children: ReactNode }) {
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
  onPage: (page: number) => void;
}) {
  const pages = pageCount(total, pageSize);
  return (
    <div className="pagination" aria-label="Sayfalama">
      <span>{total} kayıt · Sayfa {page} / {pages}</span>
      <div>
        <button
          className="secondary-button"
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Önceki
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Sonraki
        </button>
      </div>
    </div>
  );
}

function ProductsPage(props: PageProps) {
  const { path, navigate, canManage, csrfToken, onSuccess } = props;
  const match = path.match(/^\/products\/([^/]+)(?:\/(edit))?$/);
  if (path === "/products/new") {
    return (
      <ProductForm
        navigate={navigate}
        csrfToken={csrfToken}
        onSuccess={onSuccess}
      />
    );
  }
  if (match?.[1] && match[1] !== "new") {
    return (
      <ProductDetail
        id={match[1]}
        editing={match[2] === "edit"}
        navigate={navigate}
        canManage={canManage}
        csrfToken={csrfToken}
        onSuccess={onSuccess}
      />
    );
  }
  return <ProductsList {...props} />;
}

function ProductsList(props: PageProps) {
  const { navigate, canManage, csrfToken } = props;
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isActive, setIsActive] = useState("");
  const [sort, setSort] = useState("sku");
  const [direction, setDirection] = useState("asc");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Page<Product> | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort,
      direction,
    });
    if (q.trim()) params.set("q", q.trim());
    if (categoryId) params.set("categoryId", categoryId);
    if (isActive) params.set("isActive", isActive);
    Promise.all([
      api<Page<Product>>(`/api/products?${params}`, csrfToken),
      allCategories(csrfToken),
    ])
      .then(([products, categoryList]) => {
        if (cancelled) return;
        setData(products);
        setCategories(categoryList);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Ürünler yüklenemedi.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, q, categoryId, isActive, sort, direction, reload, csrfToken]);

  function changeFilter(action: () => void) {
    setPage(1);
    action();
  }

  return (
    <>
      <PageHeader
        title="Ürünler"
        subtitle="Ürün kataloğu"
        action={canManage ? (
          <Anchor className="primary-button link-button" href="/products/new" navigate={navigate}>
            Ürün ekle
          </Anchor>
        ) : undefined}
      />
      <section className="filter-bar" aria-label="Ürün filtreleri">
        <label>
          Ara
          <input
            value={q}
            maxLength={120}
            onChange={(event) => changeFilter(() => setQ(event.target.value))}
            placeholder="SKU, ürün adı veya barkod"
          />
        </label>
        <label>
          Kategori
          <select
            value={categoryId}
            onChange={(event) => changeFilter(() => setCategoryId(event.target.value))}
          >
            <option value="">Tüm kategoriler</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}{category.isActive ? "" : " (Pasif)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Durum
          <select
            value={isActive}
            onChange={(event) => changeFilter(() => setIsActive(event.target.value))}
          >
            <option value="">Tümü</option>
            <option value="true">Aktif</option>
            <option value="false">Pasif</option>
          </select>
        </label>
        <label>
          Sırala
          <select value={sort} onChange={(event) => changeFilter(() => setSort(event.target.value))}>
            <option value="sku">SKU</option>
            <option value="name">Ürün adı</option>
            <option value="category">Kategori</option>
            <option value="unit">Birim</option>
            <option value="barcode">Barkod</option>
            <option value="isActive">Durum</option>
          </select>
        </label>
        <label>
          Yön
          <select
            value={direction}
            onChange={(event) => changeFilter(() => setDirection(event.target.value))}
          >
            <option value="asc">Artan</option>
            <option value="desc">Azalan</option>
          </select>
        </label>
      </section>
      {error && <LoadError message={error} />}
      {loading ? <Loading /> : data?.items.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">Ürün adı</th>
                  <th scope="col">Kategori</th>
                  <th scope="col">Birim</th>
                  <th scope="col">Barkod</th>
                  <th scope="col">Durum</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((product) => (
                  <tr key={product.id}>
                    <td><Anchor href={`/products/${product.id}`} navigate={navigate}>{product.sku}</Anchor></td>
                    <td>{product.name}</td>
                    <td>{product.category.name}</td>
                    <td>{unitLabel(product.unit)}</td>
                    <td>{product.barcode ?? "—"}</td>
                    <td><span className={product.isActive ? "status active" : "status inactive"}>{statusLabel(product.isActive)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={setPage}
          />
        </>
      ) : !error ? <Empty>Bu filtrelerle eşleşen ürün bulunamadı.</Empty> : null}
      <button className="quiet-button reload-button" type="button" onClick={() => setReload((value) => value + 1)}>
        Listeyi yenile
      </button>
    </>
  );
}

function ProductForm({
  product,
  navigate,
  csrfToken,
  onSuccess,
}: {
  product?: Product;
  navigate: PageProps["navigate"];
  csrfToken: string;
  onSuccess: PageProps["onSuccess"];
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    name: product?.name ?? "",
    description: product?.description ?? "",
    categoryId: product?.categoryId ?? "",
    unit: product?.unit ?? "EACH",
    isActive: product?.isActive ?? true,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    allCategories(csrfToken)
      .then((items) => {
        if (!cancelled) setCategories(items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Kategoriler yüklenemedi.");
      });
    return () => {
      cancelled = true;
    };
  }, [csrfToken]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const body = {
      ...form,
      barcode: form.barcode,
      description: form.description,
      ...(product ? { expectedUpdatedAt: product.updatedAt } : {}),
    };
    try {
      const saved = await api<Product>(
        product ? `/api/products/${product.id}` : "/api/products",
        csrfToken,
        {
          method: product ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
      const destination = `/products/${saved.id}`;
      window.history.pushState(null, "", destination);
      window.dispatchEvent(new PopStateEvent("popstate"));
      onSuccess(product ? "Ürün bilgileri kaydedildi." : "Ürün oluşturuldu.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ürün kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <PageHeader title={product ? "Ürünü düzenle" : "Yeni ürün"} />
      <Anchor className="back-link" href={product ? `/products/${product.id}` : "/products"} navigate={navigate}>
        ← Ürünlere dön
      </Anchor>
      <form className="data-form" onSubmit={(event) => void submit(event)}>
        <label>SKU<input required maxLength={64} value={form.sku} onChange={(event) => update("sku", event.target.value)} autoComplete="off" /></label>
        <label>Ürün adı<input required maxLength={180} value={form.name} onChange={(event) => update("name", event.target.value)} /></label>
        <label>Barkod<input maxLength={64} value={form.barcode} onChange={(event) => update("barcode", event.target.value)} inputMode="text" /></label>
        <label>Açıklama<textarea maxLength={1000} rows={4} value={form.description} onChange={(event) => update("description", event.target.value)} /></label>
        <label>Kategori<select required value={form.categoryId} onChange={(event) => update("categoryId", event.target.value)}>
          <option value="">Kategori seçin</option>
          {categories.filter((category) => category.isActive || category.id === form.categoryId).map((category) => (
            <option key={category.id} value={category.id}>{category.name}{category.isActive ? "" : " (Pasif)"}</option>
          ))}
        </select></label>
        <label>Birim<select value={form.unit} onChange={(event) => update("unit", event.target.value as typeof form.unit)}>
          <option value="EACH">Adet</option>
          <option value="KILOGRAM">Kilogram</option>
          <option value="METER">Metre</option>
        </select></label>
        {product && <label className="checkbox-label"><input type="checkbox" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} /> Aktif</label>}
        {error && <LoadError message={error} />}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</button>
          <Anchor className="secondary-button link-button" href={product ? `/products/${product.id}` : "/products"} navigate={navigate}>Vazgeç</Anchor>
        </div>
      </form>
    </section>
  );
}

function ProductDetail({
  id,
  editing,
  navigate,
  canManage,
  csrfToken,
  onSuccess,
}: {
  id: string;
  editing: boolean;
  navigate: PageProps["navigate"];
  canManage: boolean;
  csrfToken: string;
  onSuccess: PageProps["onSuccess"];
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<Product>(`/api/products/${id}`, csrfToken)
      .then((data) => {
        if (!cancelled) setProduct(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Ürün yüklenemedi.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, csrfToken]);
  if (loading) return <Loading />;
  if (error) return <LoadError message={error} />;
  if (!product) return <Empty>Ürün bulunamadı.</Empty>;
  if (editing) {
    return <ProductForm product={product} navigate={navigate} csrfToken={csrfToken} onSuccess={onSuccess} />;
  }
  return (
    <section>
      <PageHeader
        title={product.name}
        subtitle={product.sku}
        action={canManage ? (
          <Anchor className="primary-button link-button" href={`/products/${id}/edit`} navigate={navigate}>Düzenle</Anchor>
        ) : undefined}
      />
      <dl className="details-grid">
        <Detail label="Kategori" value={product.category.name} />
        <Detail label="Birim" value={unitLabel(product.unit)} />
        <Detail label="Barkod" value={product.barcode ?? "—"} />
        <Detail label="Durum" value={statusLabel(product.isActive)} />
        <Detail label="Açıklama" value={product.description ?? "—"} />
      </dl>
      <Anchor className="back-link" href="/products" navigate={navigate}>← Ürün listesine dön</Anchor>
    </section>
  );
}

function CategoriesPage(props: PageProps) {
  const { path, navigate, canManage, csrfToken, onSuccess } = props;
  const match = path.match(/^\/categories\/([^/]+)(?:\/(edit))?$/);
  if (path === "/categories/new") {
    return <NamedForm kind="category" navigate={navigate} csrfToken={csrfToken} onSuccess={onSuccess} />;
  }
  if (match?.[1] && match[1] !== "new") {
    return (
      <NamedDetail
        kind="category"
        id={match[1]}
        editing={match[2] === "edit"}
        navigate={navigate}
        canManage={canManage}
        csrfToken={csrfToken}
        onSuccess={onSuccess}
      />
    );
  }
  return <NamedList kind="category" {...props} />;
}

function WarehousesPage(props: PageProps) {
  const { path, navigate, canManage, csrfToken, onSuccess } = props;
  if (path === "/warehouses/new") {
    return <NamedForm kind="warehouse" navigate={navigate} csrfToken={csrfToken} onSuccess={onSuccess} />;
  }
  const locationNew = path.match(/^\/warehouses\/([^/]+)\/locations\/new$/);
  if (locationNew?.[1]) {
    return <LocationForm warehouseId={locationNew[1]} navigate={navigate} csrfToken={csrfToken} onSuccess={onSuccess} />;
  }
  const locationRoute = path.match(/^\/warehouses\/([^/]+)\/locations\/([^/]+)(?:\/(edit))?$/);
  if (locationRoute?.[1] && locationRoute[2]) {
    return (
      <LocationDetail
        warehouseId={locationRoute[1]}
        locationId={locationRoute[2]}
        editing={locationRoute[3] === "edit"}
        navigate={navigate}
        canManage={canManage}
        csrfToken={csrfToken}
        onSuccess={onSuccess}
      />
    );
  }
  const match = path.match(/^\/warehouses\/([^/]+)(?:\/(edit))?$/);
  if (match?.[1] && match[1] !== "new") {
    return (
      <WarehouseDetail
        id={match[1]}
        editing={match[2] === "edit"}
        navigate={navigate}
        canManage={canManage}
        csrfToken={csrfToken}
        onSuccess={onSuccess}
      />
    );
  }
  return <NamedList kind="warehouse" {...props} />;
}

type NamedKind = "category" | "warehouse";
type NamedRecord = Category | Warehouse;

function NamedList(props: PageProps & { kind: NamedKind }) {
  const { kind, navigate, canManage, csrfToken } = props;
  const [q, setQ] = useState("");
  const [isActive, setIsActive] = useState("");
  const [sort, setSort] = useState(kind === "category" ? "name" : "code");
  const [direction, setDirection] = useState("asc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<NamedRecord> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const endpoint = kind === "category" ? "categories" : "warehouses";
  const title = kind === "category" ? "Kategoriler" : "Depolar";
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort,
      direction,
    });
    if (q.trim()) params.set("q", q.trim());
    if (isActive) params.set("isActive", isActive);
    api<Page<NamedRecord>>(`/api/${endpoint}?${params}`, csrfToken)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : `${title} yüklenemedi.`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, page, q, isActive, sort, direction, csrfToken, title]);
  function change(action: () => void) {
    setPage(1);
    action();
  }
  const createHref = kind === "category" ? "/categories/new" : "/warehouses/new";
  const baseHref = kind === "category" ? "/categories" : "/warehouses";
  return (
    <>
      <PageHeader
        title={title}
        action={canManage ? <Anchor className="primary-button link-button" href={createHref} navigate={navigate}>{kind === "category" ? "Kategori ekle" : "Depo ekle"}</Anchor> : undefined}
      />
      <section className="filter-bar">
        <label>Ara<input value={q} maxLength={120} onChange={(event) => change(() => setQ(event.target.value))} placeholder="Kod veya ad" /></label>
        <label>Durum<select value={isActive} onChange={(event) => change(() => setIsActive(event.target.value))}>
          <option value="">Tümü</option><option value="true">Aktif</option><option value="false">Pasif</option>
        </select></label>
        <label>Sırala<select value={sort} onChange={(event) => change(() => setSort(event.target.value))}>
          <option value="code">Kod</option><option value="name">Ad</option><option value="isActive">Durum</option>
        </select></label>
        <label>Yön<select value={direction} onChange={(event) => change(() => setDirection(event.target.value))}>
          <option value="asc">Artan</option><option value="desc">Azalan</option>
        </select></label>
      </section>
      {error && <LoadError message={error} />}
      {loading ? <Loading /> : data?.items.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Kod</th><th scope="col">Ad</th>{kind === "warehouse" && <th scope="col">Raf sayısı</th>}<th scope="col">Durum</th></tr></thead>
              <tbody>{data.items.map((record) => (
                <tr key={record.id}>
                  <td><Anchor href={`${baseHref}/${record.id}`} navigate={navigate}>{record.code}</Anchor></td>
                  <td>{record.name}</td>
                  {kind === "warehouse" && <td>{"_count" in record ? record._count?.locations ?? 0 : 0}</td>}
                  <td><span className={record.isActive ? "status active" : "status inactive"}>{statusLabel(record.isActive)}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      ) : !error ? <Empty>Kayıt bulunamadı.</Empty> : null}
    </>
  );
}

function NamedForm({
  kind,
  record,
  navigate,
  csrfToken,
  onSuccess,
}: {
  kind: NamedKind;
  record?: NamedRecord;
  navigate: PageProps["navigate"];
  csrfToken: string;
  onSuccess: PageProps["onSuccess"];
}) {
  const [code, setCode] = useState(record?.code ?? "");
  const [name, setName] = useState(record?.name ?? "");
  const [isActive, setIsActive] = useState(record?.isActive ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const title = kind === "category" ? "Kategori" : "Depo";
  const endpoint = kind === "category" ? "categories" : "warehouses";
  const basePath = `/${endpoint}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (record && record.isActive && !isActive) {
      const explanation = kind === "warehouse"
        ? "Depo; pozitif stok, devam eden transfer veya açık sayım varsa pasifleştirilemez. Depo geçmiş kayıtlarla korunur. Devam edilsin mi?"
        : "Kategori pasif yapılacak. Mevcut ürün ilişkileri korunur; yeni ürünlere atanamaz. Devam edilsin mi?";
      if (!window.confirm(explanation)) return;
    }
    setSaving(true);
    setError("");
    const body = {
      code,
      name,
      ...(record ? { isActive, expectedUpdatedAt: record.updatedAt } : {}),
    };
    try {
      const saved = await api<NamedRecord>(
        record ? `/api/${endpoint}/${record.id}` : `/api/${endpoint}`,
        csrfToken,
        { method: record ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      const destination = `${basePath}/${saved.id}`;
      window.history.pushState(null, "", destination);
      window.dispatchEvent(new PopStateEvent("popstate"));
      onSuccess(`${title} ${record ? "bilgileri kaydedildi" : "oluşturuldu"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${title} kaydedilemedi.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <PageHeader title={`${record ? "Düzenle" : "Yeni"} ${title.toLocaleLowerCase("tr-TR")}`} />
      <form className="data-form" onSubmit={(event) => void submit(event)}>
        <label>Kod<input required maxLength={48} value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <label>Ad<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        {record && <label className="checkbox-label"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Aktif</label>}
        {error && <LoadError message={error} />}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</button>
          <Anchor className="secondary-button link-button" href={record ? `${basePath}/${record.id}` : basePath} navigate={navigate}>Vazgeç</Anchor>
        </div>
      </form>
    </section>
  );
}

function NamedDetail({
  kind,
  id,
  editing,
  navigate,
  canManage,
  csrfToken,
  onSuccess,
}: {
  kind: NamedKind;
  id: string;
  editing: boolean;
  navigate: PageProps["navigate"];
  canManage: boolean;
  csrfToken: string;
  onSuccess: PageProps["onSuccess"];
}) {
  const endpoint = kind === "category" ? "categories" : "warehouses";
  const [record, setRecord] = useState<NamedRecord | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<NamedRecord>(`/api/${endpoint}/${id}`, csrfToken)
      .then((value) => {
        if (!cancelled) setRecord(value);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Kayıt yüklenemedi.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [endpoint, id, csrfToken]);
  if (loading) return <Loading />;
  if (error) return <LoadError message={error} />;
  if (!record) return <Empty>Kayıt bulunamadı.</Empty>;
  if (editing) {
    return <NamedForm kind={kind} record={record} navigate={navigate} csrfToken={csrfToken} onSuccess={onSuccess} />;
  }
  const title = kind === "category" ? "Kategori" : "Depo";
  const basePath = `/${endpoint}`;
  return (
    <section>
      <PageHeader title={record.name} subtitle={`${title} · ${record.code}`} action={canManage ? (
        <Anchor className="primary-button link-button" href={`${basePath}/${id}/edit`} navigate={navigate}>Düzenle</Anchor>
      ) : undefined} />
      <dl className="details-grid">
        <Detail label="Kod" value={record.code} />
        <Detail label="Ad" value={record.name} />
        <Detail label="Durum" value={statusLabel(record.isActive)} />
      </dl>
      <Anchor className="back-link" href={basePath} navigate={navigate}>← {title} listesine dön</Anchor>
    </section>
  );
}

function WarehouseDetail({
  id,
  editing,
  navigate,
  canManage,
  csrfToken,
  onSuccess,
}: {
  id: string;
  editing: boolean;
  navigate: PageProps["navigate"];
  canManage: boolean;
  csrfToken: string;
  onSuccess: PageProps["onSuccess"];
}) {
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<Warehouse>(`/api/warehouses/${id}`, csrfToken)
      .then((value) => { if (!cancelled) setWarehouse(value); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Depo yüklenemedi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, csrfToken]);
  if (loading) return <Loading />;
  if (error) return <LoadError message={error} />;
  if (!warehouse) return <Empty>Depo bulunamadı.</Empty>;
  if (editing) return <NamedForm kind="warehouse" record={warehouse} navigate={navigate} csrfToken={csrfToken} onSuccess={onSuccess} />;
  return (
    <section>
      <PageHeader
        title={warehouse.name}
        subtitle={`Depo · ${warehouse.code}`}
        action={canManage ? (
          <div className="header-actions">
            <Anchor className="secondary-button link-button" href={`/warehouses/${id}/locations/new`} navigate={navigate}>Raf ekle</Anchor>
            <Anchor className="primary-button link-button" href={`/warehouses/${id}/edit`} navigate={navigate}>Düzenle</Anchor>
          </div>
        ) : undefined}
      />
      <dl className="details-grid">
        <Detail label="Kod" value={warehouse.code} />
        <Detail label="Durum" value={statusLabel(warehouse.isActive)} />
      </dl>
      <div className="section-heading-row">
        <h2>Raflar ve konumlar</h2>
        {canManage && <Anchor className="text-link" href={`/warehouses/${id}/locations/new`} navigate={navigate}>Raf ekle</Anchor>}
      </div>
      {warehouse.locations?.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Kod</th><th scope="col">Ad</th><th scope="col">Durum</th></tr></thead>
            <tbody>{warehouse.locations.map((location) => (
              <tr key={location.id}>
                <td><Anchor href={`/warehouses/${id}/locations/${location.id}`} navigate={navigate}>{location.code}</Anchor></td>
                <td>{location.name}</td>
                <td><span className={location.isActive ? "status active" : "status inactive"}>{statusLabel(location.isActive)}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <Empty>Bu depoda henüz raf veya konum yok.</Empty>}
      <p className="help-note">Raflar yerleşim bilgisidir; ayrı stok miktarı tutmaz.</p>
      <Anchor className="back-link" href="/warehouses" navigate={navigate}>← Depolara dön</Anchor>
    </section>
  );
}

function LocationForm({
  warehouseId,
  location,
  navigate,
  csrfToken,
  onSuccess,
}: {
  warehouseId: string;
  location?: Location;
  navigate: PageProps["navigate"];
  csrfToken: string;
  onSuccess: PageProps["onSuccess"];
}) {
  const [code, setCode] = useState(location?.code ?? "");
  const [name, setName] = useState(location?.name ?? "");
  const [isActive, setIsActive] = useState(location?.isActive ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (location?.isActive && !isActive && !window.confirm("Raf pasif yapılacak. Raf bilgisi ve geçmiş ilişkiler korunur. Devam edilsin mi?")) return;
    setSaving(true);
    setError("");
    try {
      const saved = await api<Location>(
        location
          ? `/api/warehouses/${warehouseId}/locations/${location.id}`
          : `/api/warehouses/${warehouseId}/locations`,
        csrfToken,
        {
          method: location ? "PATCH" : "POST",
          body: JSON.stringify({
            code,
            name,
            ...(location ? { isActive, expectedUpdatedAt: location.updatedAt } : {}),
          }),
        },
      );
      const destination = `/warehouses/${warehouseId}/locations/${saved.id}`;
      window.history.pushState(null, "", destination);
      window.dispatchEvent(new PopStateEvent("popstate"));
      onSuccess(location ? "Raf bilgileri kaydedildi." : "Raf oluşturuldu.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Raf kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section>
      <PageHeader title={location ? "Rafı düzenle" : "Yeni raf"} />
      <form className="data-form" onSubmit={(event) => void submit(event)}>
        <label>Raf kodu<input required maxLength={48} value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <label>Ad<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        {location && <label className="checkbox-label"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Aktif</label>}
        {error && <LoadError message={error} />}
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</button>
          <Anchor className="secondary-button link-button" href={`/warehouses/${warehouseId}`} navigate={navigate}>Vazgeç</Anchor>
        </div>
      </form>
    </section>
  );
}

function LocationDetail({
  warehouseId,
  locationId,
  editing,
  navigate,
  canManage,
  csrfToken,
  onSuccess,
}: {
  warehouseId: string;
  locationId: string;
  editing: boolean;
  navigate: PageProps["navigate"];
  canManage: boolean;
  csrfToken: string;
  onSuccess: PageProps["onSuccess"];
}) {
  const [location, setLocation] = useState<Location | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api<Location>(`/api/warehouses/${warehouseId}/locations/${locationId}`, csrfToken)
      .then((value) => { if (!cancelled) setLocation(value); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Raf yüklenemedi."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warehouseId, locationId, csrfToken]);
  if (loading) return <Loading />;
  if (error) return <LoadError message={error} />;
  if (!location) return <Empty>Raf bulunamadı.</Empty>;
  if (editing) return <LocationForm warehouseId={warehouseId} location={location} navigate={navigate} csrfToken={csrfToken} onSuccess={onSuccess} />;
  return (
    <section>
      <PageHeader title={location.name} subtitle={`Raf · ${location.code}`} action={canManage ? (
        <Anchor className="primary-button link-button" href={`/warehouses/${warehouseId}/locations/${locationId}/edit`} navigate={navigate}>Düzenle</Anchor>
      ) : undefined} />
      <dl className="details-grid">
        <Detail label="Kod" value={location.code} />
        <Detail label="Durum" value={statusLabel(location.isActive)} />
      </dl>
      <Anchor className="back-link" href={`/warehouses/${warehouseId}`} navigate={navigate}>← Depoya dön</Anchor>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="detail"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default CatalogApp;
