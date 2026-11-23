import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { cfsmGet } from "@/services/cfsm/http";
import { getServerApiBase } from "@/services/api";
import { HomeInstanceLink } from "@/components/node/HomeInstanceLink";

const schema = z.object({
  measured_at: z.number().nullable(), state: z.string().optional(), error: z.string().optional(),
  routes: z.array(z.object({
    carrier: z.enum(["telecom", "unicom", "mobile"]),
    target: z.string(), status: z.enum(["ok", "incomplete", "error", "unsupported"]), error: z.string(),
    source: z.object({ country: z.string(), city: z.string(), asn: z.number(), network: z.string() }).nullable().optional(),
    hops: z.array(z.object({ ttl: z.number(), ip: z.string().nullable(), asn: z.number().nullable(), rtt: z.number().nullable() })),
  })),
});
type Direction = "forward" | "return";
type Route = z.infer<typeof schema>["routes"][number];
const names = { telecom: "电信", unicom: "联通", mobile: "移动" };
const carriers = Object.keys(names) as Array<keyof typeof names>;
const networks: Record<number, string> = {
  4134: "163", 4809: "CN2", 4837: "169", 9929: "9929",
  58807: "CMIN2", 58453: "CMI", 9808: "移动骨干",
};

function useRoutes(uuid: string, direction: Direction, family: number) {
  return useQuery({
    queryKey: [`${direction}-routes`, uuid, family, getServerApiBase(uuid)],
    queryFn: ({ signal }) => cfsmGet(`/api/${direction}-routes?id=${encodeURIComponent(uuid)}&family=${family}`, schema, { base: getServerApiBase(uuid), signal }),
    staleTime: 60_000, refetchInterval: 60_000, retry: false,
  });
}

export function routeLabel(route?: Route) {
  if (!route) return "未探测";
  if (route.status === "unsupported") return "无可用出口";
  if (route.status === "error") return "探测失败";
  const evidence = [...new Set(route.hops.map(h => h.asn === null ? undefined : networks[h.asn]).filter(Boolean))];
  return evidence.length ? evidence.join(" → ") : "未识别";
}

function FamilySwitch({ family, onChange }: { family: number; onChange: (family: number) => void }) {
  return <div className="flex shrink-0 gap-1" role="group" aria-label="IP 协议">
    {[4, 6].map(value => <button key={value} type="button" aria-pressed={family === value} onClick={() => onChange(value)}
      className="rounded-md px-2 py-1 text-xs" style={{ background: family === value ? "var(--progress-bg)" : "transparent", color: family === value ? "var(--text-primary)" : "var(--text-secondary)" }}>IPv{value}</button>)}
  </div>;
}

function timeLabel(time?: number | null) {
  if (!time) return "暂无结果";
  const date = new Date(time);
  return `${date.getMonth() + 1}-${date.getDate()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function RouteCell({ route, query, direction }: { route?: Route; query: ReturnType<typeof useRoutes>; direction: Direction }) {
  const running = ["pending", "enriching"].includes(query.data?.state || "");
  const label = !route ? query.isPending ? "读取中…" : query.isError ? "读取失败" : running ? "检测中…" : query.data?.error ? "暂不可用" : direction === "return" ? "未上报" : "待检测" : routeLabel(route);
  const time = query.data?.measured_at;
  const stale = Boolean(time && Date.now() - time > 24 * 3600_000);
  const evidence = route?.hops.some(h => h.asn !== null && networks[h.asn]);
  const title = [route?.source ? `中国 · ${route.source.city} · ${route.source.network}` : "",
    time ? new Date(time).toLocaleString() : "", route?.error || query.data?.error,
    route?.status === "incomplete" ? "路径不完整，仅显示已识别网络" : "", stale ? "结果已超过 24 小时" : "",
    "依据逐跳 ASN 识别，不代表商业线路等级"].filter(Boolean).join("；");
  return <div className="min-w-0 text-center" title={title}>
    <div className="rounded-lg px-1.5 py-1 font-semibold wrap-break-word" style={{
      background: evidence ? `color-mix(in srgb, ${direction === "forward" ? "var(--status-success, #219b7a)" : "var(--status-warning, #c49339)"} 12%, transparent)` : "var(--progress-bg)",
      color: evidence ? direction === "forward" ? "var(--status-success, #219b7a)" : "var(--status-warning, #c49339)" : "var(--text-secondary)",
    }}>{label}{route?.status === "incomplete" ? " *" : ""}{stale ? " · 过期" : ""}</div>
    {route?.source && <div className="mt-0.5 truncate text-[10px] text-(--text-secondary)">{route.source.city}</div>}
  </div>;
}

export function ReturnRouteSummary({ uuid }: { uuid: string }) {
  const [family, setFamily] = useState(4);
  const forward = useRoutes(uuid, "forward", family), back = useRoutes(uuid, "return", family);
  return <section className="mt-2 min-w-0 rounded-xl bg-(--bg-secondary) p-3 text-xs" aria-label="三网去程和回程">
    <div className="mb-2 flex items-center justify-between gap-1">
      <span className="font-semibold text-(--text-primary)">三网线路</span>
      <FamilySwitch family={family} onChange={setFamily} />
    </div>
    <HomeInstanceLink uuid={uuid} className="block" aria-label={`查看 IPv${family} 三网线路详情`}>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
        <span /><span className="text-center text-(--text-secondary)">去程</span><span className="text-center text-(--text-secondary)">回程</span>
        {carriers.map(carrier => <div key={carrier} className="contents">
          <span className="text-(--text-secondary)">{names[carrier]}</span>
          <RouteCell route={forward.data?.routes.find(r => r.carrier === carrier)} query={forward} direction="forward" />
          <RouteCell route={back.data?.routes.find(r => r.carrier === carrier)} query={back} direction="return" />
        </div>)}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-1 text-[10px] text-(--text-secondary)">
        <span>去 {forward.data?.error ? "检测异常 · " : ""}{timeLabel(forward.data?.measured_at)}</span><span>回 {timeLabel(back.data?.measured_at)}</span>
      </div>
    </HomeInstanceLink>
  </section>;
}

function DirectionDetails({ uuid, family, direction }: { uuid: string; family: number; direction: Direction }) {
  const query = useRoutes(uuid, direction, family);
  const forward = direction === "forward";
  return <div className="mt-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-medium">三网{forward ? "去程" : "回程"} · IPv{family}</h3>
      <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="text-xs disabled:opacity-50">{query.isFetching ? "读取中…" : "刷新结果"}</button>
    </div>
    <p className="mt-2 text-xs text-(--text-secondary)">{forward ? "国内三网探针 → 节点 · Globalping 每小时自动检测" : "节点 → 国内三网目标 · 节点脚本每小时上报"}，刷新仅读取缓存。</p>
    {query.isPending && <p role="status" className="mt-3 text-sm">正在读取线路数据…</p>}
    {query.isError && <p role="alert" className="mt-3 text-sm">无法读取数据，请确认后端已升级且当前账号有访问权限。</p>}
    {query.data && <>
      <p className="mt-2 text-xs text-(--text-secondary)">{query.data.measured_at ? `检测时间：${new Date(query.data.measured_at).toLocaleString()}${Date.now() - query.data.measured_at > 24 * 3600_000 ? "（结果已超过 24 小时）" : ""}` : forward ? "等待后台首次检测，通常需要数分钟。" : `暂无 IPv${family} 回程数据，请更新并运行此节点的双栈回程脚本。`}</p>
      {["pending", "enriching"].includes(query.data.state || "") && <p role="status" className="mt-2 text-xs">{query.data.state === "enriching" ? "正在补充逐跳 ASN 信息…" : "正在检测，完成后自动更新…"}</p>}
      {query.data.error && <p role="status" className="mt-2 text-sm">最近检测：{query.data.error}{query.data.measured_at ? "；以下保留上次结果。" : ""}</p>}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">{query.data.routes.map(route => <article key={route.carrier} className="min-w-0 rounded-lg bg-(--bg-secondary) p-3">
        <h4 className="font-medium">{names[route.carrier]} <span className="text-xs">{route.status === "ok" ? "已到达" : route.status === "incomplete" ? "路径不完整" : route.status === "unsupported" ? "无可用出口" : "探测失败"}</span></h4>
        {route.source && <p className="mt-1 break-words text-xs">起点：中国 · {route.source.city} · {route.source.network}（AS{route.source.asn}）</p>}
        <p className="mt-1 break-all text-xs">目标：{route.target}</p>
        <p className="mt-2 text-sm">途经：{routeLabel(route)}</p>
        <p className="mt-1 text-xs text-(--text-secondary)">依据逐跳 ASN，仅代表该起点与目标的路径；不能据此确定 GIA / GT 等商业等级。</p>
        {route.error && <p className="mt-2 break-words text-sm" role="status">{route.error}</p>}
        <details className="mt-3"><summary className="cursor-pointer text-sm">逐跳路径（{route.hops.length} 跳）</summary>
          {forward && <p className="mt-1 text-xs text-(--text-secondary)">登录后可查看逐跳 IP。</p>}
          <div className="overflow-x-auto"><table className="mt-2 w-full text-left text-xs"><thead><tr><th>跳</th><th>IP / ASN</th><th>延迟</th></tr></thead><tbody>{route.hops.map((hop, index) => <tr key={index}><td className="py-1">{hop.ttl}</td><td>{hop.ip ?? "—"}<br />{hop.asn ? `AS${hop.asn}` : "—"}</td><td>{hop.rtt === null ? "—" : `${hop.rtt.toFixed(1)} ms`}</td></tr>)}</tbody></table></div>
        </details>
      </article>)}</div>
    </>}
  </div>;
}

export function ReturnRoutes({ uuid }: { uuid: string }) {
  const [family, setFamily] = useState(4);
  return <section className="rounded-xl border border-(--border-color) p-4" aria-label="三网去程和回程详情">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">三网线路</h2><FamilySwitch family={family} onChange={setFamily} /></div>
    <DirectionDetails uuid={uuid} family={family} direction="forward" />
    <DirectionDetails uuid={uuid} family={family} direction="return" />
  </section>;
}
