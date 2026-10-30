// The one-screen architecture of Kitoko Receptionist, as an inline SVG drawn in a 360-wide box so it reads at phone
// width and scales up on desktop. Colors are the landing's tokens (ink, honey, stone, hairline).

const INK = "var(--color-ink)";
const HONEY = "var(--color-honey)";
const LINE = "var(--color-hairline)";
const MUTED = "var(--color-muted)";
const SURFACE = "var(--color-surface)";

type BoxProps = { x: number; y: number; w: number; h: number; title: string; sub?: string; dark?: boolean };

function Box({ x, y, w, h, title, sub, dark }: BoxProps) {
  const cx = x + w / 2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} fill={dark ? INK : SURFACE} stroke={dark ? INK : LINE} />
      <text x={cx} y={sub ? y + h / 2 - 3 : y + h / 2 + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill={dark ? SURFACE : INK}>
        {title}
      </text>
      {sub && (
        <text x={cx} y={y + h / 2 + 14} textAnchor="middle" fontSize={11.5} fill={dark ? "var(--color-on-inverse-muted)" : MUTED}>
          {sub}
        </text>
      )}
    </g>
  );
}

function Arrow({ d, label, lx, ly }: { d: string; label?: string; lx?: number; ly?: number }) {
  return (
    <g>
      <path d={d} fill="none" stroke={MUTED} strokeWidth={1.5} markerEnd="url(#hiw-arrow)" />
      {label && (
        <text x={lx} y={ly} fontSize={11} fill={MUTED}>
          {label}
        </text>
      )}
    </g>
  );
}

const PAYPAL_APIS = [
  ["Orders v2 + JS SDK v6", "deposit"],
  ["Webhooks", "verified, deduped"],
  ["Refunds", "cancellation policy"],
  ["Payouts", "pay the stylist"],
  ["Invoicing v2", "the balance"],
  ["Reporting · Disputes", "Agent Toolkit"],
] as const;

export function ArchitectureDiagram() {
  return (
    <svg
      viewBox="0 0 360 536"
      role="img"
      aria-labelledby="hiw-diagram-title hiw-diagram-desc"
      className="h-auto w-full font-sans"
    >
      <title id="hiw-diagram-title">Kitoko architecture</title>
      <desc id="hiw-diagram-desc">
        Web chat, WhatsApp and MCP clients talk to a Claude agent. Its tools call the booking services, which move money
        through PayPal and store bookings in Supabase. Supabase Realtime updates the stylist&apos;s Bryntum calendar.
      </desc>
      <defs>
        <marker id="hiw-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={MUTED} />
        </marker>
      </defs>

      <text x={0} y={12} fontSize={11} fontWeight={600} letterSpacing="0.08em" fill={MUTED}>
        CHANNELS
      </text>
      <Box x={0} y={22} w={112} h={50} title="Web chat" sub="her page" />
      <Box x={124} y={22} w={112} h={50} title="WhatsApp" sub="Cloud API" />
      <Box x={248} y={22} w={112} h={50} title="MCP" sub="outside AI agents" />

      <Arrow d="M56,72 C56,92 150,90 168,108" />
      <Arrow d="M180,72 L180,106" />
      <Arrow d="M304,72 C304,92 210,90 192,108" />

      <Box x={40} y={110} w={280} h={56} title="Claude agent" sub="client front desk · her assistant · tools" dark />

      <Arrow d="M180,166 L180,196" label="tool calls (ids, never amounts)" lx={188} ly={186} />

      <rect x={0} y={198} width={360} height={58} rx={14} fill={SURFACE} stroke={LINE} />
      <rect x={0} y={198} width={6} height={58} rx={3} fill={HONEY} />
      <text x={180} y={222} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>
        Services · booking engine
      </text>
      <text x={180} y={241} textAnchor="middle" fontSize={11.5} fill={MUTED}>
        slots · quote · hold · deposit · policy · payout
      </text>

      <Arrow d="M104,256 L104,288" />
      <Arrow d="M290,256 L290,288" />

      {/* PayPal */}
      <rect x={0} y={290} width={208} height={196} rx={14} fill={SURFACE} stroke={HONEY} strokeWidth={1.5} />
      <text x={14} y={314} fontSize={14} fontWeight={700} fill={INK}>
        PayPal
      </text>
      <text x={194} y={314} textAnchor="end" fontSize={11} fill={MUTED}>
        sandbox
      </text>
      {PAYPAL_APIS.map(([api, use], i) => (
        <g key={api}>
          <circle cx={18} cy={336 + i * 25} r={2.5} fill={HONEY} />
          <text x={28} y={340 + i * 25} fontSize={12} fontWeight={600} fill={INK}>
            {api}
          </text>
          <text x={28} y={352 + i * 25} fontSize={10} fill={MUTED}>
            {use}
          </text>
        </g>
      ))}

      {/* Supabase */}
      <Box x={222} y={290} w={138} h={88} title="Supabase" sub="Postgres + RLS" />
      <text x={291} y={364} textAnchor="middle" fontSize={10} fill={MUTED}>
        bookings · agent_events
      </text>
      <Arrow d="M208,350 L220,350" />

      <Arrow d="M291,378 L291,440" />
      <text x={298} y={432} fontSize={11} fill={MUTED}>
        Realtime
      </text>

      <Box x={222} y={442} w={138} h={56} title="Bryntum" sub="her live calendar" />
      <text x={0} y={526} fontSize={11} fill={MUTED}>
        <tspan fontWeight={600} fill={INK}>
          Back loop:
        </tspan>{" "}
        calendar drag or sick day → agent → client
      </text>
    </svg>
  );
}
