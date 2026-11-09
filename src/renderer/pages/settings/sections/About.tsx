import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { rise } from '@/lib/motion';
import { velaPages, type VelaPagesAPI } from '@/lib/vela';
import { VelaMark } from '../components/brand';
import { Group, Row } from '../components/layout';
import { hasBridge } from '../store';

const REPO_URL = 'https://github.com/Aepzie/vela';

type Versions = Awaited<ReturnType<VelaPagesAPI['version']>>;

export function About() {
  const [versions, setVersions] = useState<Versions | null>(null);

  useEffect(() => {
    if (!hasBridge()) return;
    let alive = true;
    velaPages()
      .version()
      .then((next) => alive && setVersions(next), () => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const pills: readonly [string, string | undefined][] = [
    ['Vela', versions?.app],
    ['Electron', versions?.electron],
    ['Chromium', versions?.chrome],
    ['V8', versions?.v8],
  ];

  return (
    <>
      <motion.header variants={rise} className="mb-8 flex flex-col items-start gap-4 pt-2">
        <div className="relative">
          <div
            aria-hidden
            className="absolute -inset-4 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent-space)_35%,transparent),transparent)] blur-md"
          />
          <div className="relative grid size-16 place-items-center rounded-2xl bg-card ring-1 ring-border shadow-[inset_0_1px_0_var(--island-highlight)]">
            <VelaMark className="size-9 text-foreground" />
          </div>
        </div>
        <div>
          <h1 className="text-[22px] leading-8 font-semibold tracking-tight">Vela</h1>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">A fast, quiet, open-source browser.</p>
        </div>
        <ul className="flex flex-wrap gap-2" aria-label="Version information">
          {pills.map(([label, value]) => (
            <li
              key={label}
              className="inline-flex h-7 items-center gap-2 rounded-full bg-muted px-3 font-mono text-[11px] ring-1 ring-border"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="text-foreground tabular-nums">{value ?? '—'}</span>
            </li>
          ))}
        </ul>
      </motion.header>

      <Group>
        <Row title="License" description="Free and open source.">
          <span className="font-mono text-xs text-muted-foreground">MIT</span>
        </Row>
        <Row title="Source code" description="Issues, roadmap and contributions.">
          <a
            href={REPO_URL}
            onClick={(event) => {
              if (!hasBridge()) return;
              event.preventDefault();
              void velaPages().navigate(REPO_URL);
            }}
            className="group inline-flex items-center gap-1 rounded-md font-mono text-xs text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            github.com/Aepzie/vela
            <ArrowUpRight
              className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              strokeWidth={1.75}
              aria-hidden
            />
          </a>
        </Row>
      </Group>
    </>
  );
}
