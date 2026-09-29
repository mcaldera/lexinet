import { useMemo } from 'react';
import { SUPPLY } from '../config';
import type { AppData } from '../db/repo';
import { previewNode, supplyNodes, type SupplyNow } from '../supplyState';

type Props = {
  data: AppData;
  supply: SupplyNow;
  nameOf: (id: string) => string;
  regionName: (id: string) => string;
  /** The word previewed on the map, with what a node there would bring. */
  preview?: { id: string; gained: number; reach: number; stronger: number };
  onPreview: (id: string | undefined) => void;
  onPlace: (id: string) => void;
  onClose: () => void;
};

/** Words worth ranking: the weakest supplied or cut off first (a node helps most there). */
const CANDIDATES = 60;

/**
 * Placing an earned supply node: the words you hold ranked by what a node on
 * them would bring (words reconnected, then words newly inside your supply).
 * Hovering a row or a word on the map shows its supply on the map; a click
 * on either places it.
 */
export default function PlacePanel(props: Props) {
  const { data, supply, nameOf, regionName, preview, onPreview, onPlace, onClose } = props;
  const ranked = useMemo(() => {
    const nodes = new Set(supplyNodes(data));
    const held = [...data.states]
      .filter(([id, st]) => st === 'conquered' && !nodes.has(id) && !supply.broken.has(id))
      .map(([id]) => id)
      .sort((a, b) => (supply.flow.value.get(a) ?? 0) - (supply.flow.value.get(b) ?? 0))
      .slice(0, CANDIDATES);
    return held
      .map((id) => ({ id, ...previewNode(supply, id) }))
      .sort((a, b) => b.gained - a.gained || b.reach - a.reach || b.stronger - a.stronger)
      .slice(0, 6);
  }, [data, supply]);
  return (
    <div className="panel border-amber-400/40 p-4 text-sm">
      <div className="flex justify-between text-xs text-amber-200">
        <span>⚡ Place a supply node</span>
        <button className="text-slate-500 hover:text-slate-200" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Click a word you hold on the map, or pick one here.
      </p>
      {preview && !ranked.some((r) => r.id === preview.id) && (
        <p className="mt-2 text-xs text-amber-100">
          {nameOf(preview.id)}: <Gain {...preview} />
        </p>
      )}
      <ul className="mt-3 space-y-1.5" onMouseLeave={() => onPreview(undefined)}>
        {ranked.map((r) => (
          <li key={r.id}>
            <button
              onMouseEnter={() => onPreview(r.id)}
              onFocus={() => onPreview(r.id)}
              onClick={() => onPlace(r.id)}
              className={`w-full rounded border px-3 py-2 text-left hover:border-amber-400 hover:bg-amber-400/10 ${
                preview?.id === r.id ? 'border-amber-400 bg-amber-400/10' : 'border-slate-700'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-100">{nameOf(r.id)}</span>
                <span className="shrink-0 text-xs text-slate-500">{regionName(r.id)}</span>
              </div>
              <div className="text-xs">
                <Gain {...r} />
                <span className="text-slate-500">
                  {' '}
                  · supply here {Math.round((supply.flow.value.get(r.id) ?? 0) * 100)}%
                  {(supply.flow.value.get(r.id) ?? 0) < SUPPLY.min && ' (cut off)'}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What a node there would bring: reconnected words, new ground, stronger words. */
function Gain({ gained, reach, stronger }: { gained: number; reach: number; stronger: number }) {
  const parts = [
    gained > 0 && `+${gained} reconnected`,
    reach > 0 && `+${reach} in supply`,
    stronger > 0 && `${stronger} stronger`,
  ].filter(Boolean);
  return (
    <span className="text-amber-300">
      {parts.length ? parts.join(' · ') : 'little change here'}
    </span>
  );
}
