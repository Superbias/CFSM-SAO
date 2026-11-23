import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { cfsmGet } from "@/services/cfsm/http";
import { getServerApiBase } from "@/services/api";

const schema = z.object({
  measured_at: z.number().nullable(),
  routes: z.array(z.object({
    carrier: z.enum(["telecom", "unicom", "mobile"]),
    target: z.string(), status: z.enum(["ok", "incomplete", "error"]), error: z.string(),
    hops: z.array(z.object({ ttl: z.number(), ip: z.string().nullable(), asn: z.number().nullable(), rtt: z.number().nullable() })),
  })),
});
const names = { telecom: "电信", unicom: "联通", mobile: "移动" };
// ASN evidence describes networks traversed, not a commercial service guarantee.
const networks: Record<number, string> = {
  4134: "电信 163", 4809: "电信 CN2", 4837: "联通 169", 9929: "联通 9929",
  58807: "移动 CMIN2", 58453: "移动 CMI", 9808: "中国移动",
};

export function ReturnRoutes({ uuid }: { uuid: string }) {
  const query = useQuery({
    queryKey: ["return-routes", uuid, getServerApiBase(uuid)],
    queryFn: ({ signal }) => cfsmGet(`/api/return-routes?id=${encodeURIComponent(uuid)}`, schema, { base: getServerApiBase(uuid), signal }),
    staleTime: 60_000, retry: false,
  });
  const stale = query.data?.measured_at && Date.now() - query.data.measured_at > 24 * 3600_000;
  return <section className="rounded-xl border border-(--border-color) p-4" aria-label="三网回程">
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold">三网回程</h2>
      <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="text-sm disabled:opacity-50">{query.isFetching ? "读取中…" : "刷新结果"}</button>
    </div>
    <p className="mt-2 text-xs text-(--text-secondary)">节点 → 三网目标 · 刷新读取最近上报结果</p>
    {query.isPending && <p role="status" className="mt-3 text-sm">正在读取回程数据…</p>}
    {query.isError && <p role="alert" className="mt-3 text-sm">无法读取回程数据，请确认后端已升级且当前账号有访问权限。</p>}
    {query.data && <>
      <p className="mt-2 text-xs text-(--text-secondary)">{query.data.measured_at ? `上报时间：${new Date(query.data.measured_at).toLocaleString()}${stale ? "（超过 24 小时，结果可能已过期）" : ""}` : "暂无探测结果，请在此节点安装并运行回程探测脚本。"}</p>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">{query.data.routes.map(route => {
        const evidence = [...new Set(route.hops.map(h => h.asn).filter((asn): asn is number => asn !== null && Boolean(networks[asn])))];
        return <article key={route.carrier} className="min-w-0 rounded-lg bg-(--bg-secondary) p-3">
          <h3 className="font-medium">{names[route.carrier]} <span className="text-xs">{route.status === "ok" ? "已到达" : route.status === "incomplete" ? "路径不完整" : "探测失败"}</span></h3>
          <p className="mt-1 break-all text-xs">目标：{route.target}</p>
          <p className="mt-2 text-sm">{evidence.length ? `途经：${evidence.map(asn => networks[asn]).join(" → ")}` : "线路无法确定"}</p>
          <p className="mt-1 text-xs text-(--text-secondary)">依据逐跳 ASN，仅代表该目标路径；不能据此确定 GIA / GT 等商业等级。</p>
          {route.error && <p className="mt-2 break-words text-sm" role="status">{route.error}</p>}
          <details className="mt-3"><summary className="cursor-pointer text-sm">逐跳路径（{route.hops.length} 跳）</summary>
            <div className="overflow-x-auto"><table className="mt-2 w-full text-left text-xs"><thead><tr><th>跳</th><th>IP / ASN</th><th>延迟</th></tr></thead><tbody>{route.hops.map((hop, index) => <tr key={index}><td className="py-1">{hop.ttl}</td><td>{hop.ip ?? "*"}<br />{hop.asn ? `AS${hop.asn}` : "—"}</td><td>{hop.rtt === null ? "—" : `${hop.rtt.toFixed(1)} ms`}</td></tr>)}</tbody></table></div>
          </details>
        </article>;
      })}</div>
    </>}
  </section>;
}
