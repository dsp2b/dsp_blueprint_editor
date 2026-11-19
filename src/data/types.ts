/** Game version the generated data under src/data comes from (tools/extract convert). */
export const supportedGameVersion = '0.10.35';

export interface Item {
    id: number;
    models: number[];
    name: string;
    icon: string;
    /** page, row, column */
    grid: [number, number, number];
    productive?: boolean;
    /** Building tier within its upgrade line (0 for non-buildings). Always emitted by the converter. */
    grade?: number;
    /** Item ids of the whole upgrade line, in tier order. Always emitted by the converter. */
    upgrades?: number[];
    /** Build-bar slot code of the building (0 for non-buildings). Always emitted by the converter. */
    buildIndex?: number;
}

export interface ItemStack {
    item: Item;
    count: number;
}

export interface Recipe {
    id: number;
    name: string;
    icon?: string;
    /** in 1/60 sec */
    time: number;
    from: ItemStack[];
    to: ItemStack[];
    /** page, row, column */
    grid: [number, number, number];
    nonProductive?: boolean;
}

export interface Tech {
    id: number;
}

export interface Signal {
    id: number;
    gridPos: [row: number, column: number];
}

export interface MIDI {
    id: number;
    isInstrument: boolean;
    pitchRange: [number, number];
}
