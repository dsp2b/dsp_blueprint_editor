import { allAssemblers } from '@/data/items';
import pako from 'pako';
import { digest } from './md5';

export interface BlueprintArea {
    index: number;
    parentIndex: number;
    tropicAnchor: number;
    areaSegments: number;
    anchorLocalOffset: {
        x: number;
        y: number;
    };
    size: {
        x: number;
        y: number;
    };
}

interface XYZ {
    x: number, y: number, z: number,
}
export interface BlueprintBuilding {
    index: number,
    areaIndex: number,
    localOffset: [ XYZ, XYZ ],
    yaw: [ number, number ],
    tilt: [ number, number ],
    pitch: [ number, number ],
    itemId: number,
    modelIndex: number,
    outputObjIdx: number,
    inputObjIdx: number,
    outputToSlot: number,
    inputFromSlot: number,
    outputFromSlot: number,
    inputToSlot: number,
    outputOffset: number,
    inputOffset: number,
    recipeId: number,
    filterId: number,
    parameters: null | AllParameters,
    /** 0.10.34+ 建筑附带的文本（-102 格式） */
    content: string | null,
}

export interface BlueprintData {
    header: {
        /** 头部格式版本：0 为旧格式，>=1 (0.10.34+) 多 author/customVersion/externalFields 字段 */
        patch: number;
        layout: number;
        icons: number[];
        time: Date;
        gameVersion: string;
        shortDesc: string;
        author: string;
        customVersion: string;
        externalFields: string;
        desc: string;
    };
    version: number;
    cursorOffset: { x: number, y: number };
    cursorTargetArea: number;
    dragBoxSize: { x: number, y: number };
    primaryAreaIdx: number;
    areas: BlueprintArea[];
    buildings: BlueprintBuilding[];
    /** 建筑列表之后的原始字节（Version>=2 时为 Patch + 地基数据 BPReformData），导出时原样写回 */
    tail: Uint8Array;
}

abstract class BufferIO {
    protected pos = 0;
    constructor(protected view: DataView) { }

    getView(length: number) {
        const r = new DataView(this.view.buffer, this.view.byteOffset + this.pos, length);
        this.pos += length;
        return r;
    }
}

class BufferReader extends BufferIO {
    getUint8() { const v = this.view.getUint8(this.pos);       this.pos += 1; return v }
    getInt8()  { const v = this.view.getInt8(this.pos);        this.pos += 1; return v }
    getInt16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v }
    getInt32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v }

    getFloat32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v }

    /** .NET BinaryReader.ReadString：7-bit 变长长度前缀 + UTF-8 */
    getString() {
        let length = 0;
        for (let shift = 0; ; shift += 7) {
            const b = this.getUint8();
            length |= (b & 0x7F) << shift;
            if ((b & 0x80) === 0)
                break;
        }
        return new TextDecoder().decode(this.getBytes(length));
    }

    getBytes(length: number) {
        const v = this.getView(length);
        return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + length));
    }

    remaining() { return this.view.byteLength - this.pos; }
}

class BufferWriter extends BufferIO {
    setUint8(value: number) { this.view.setUint8(this.pos, value);       this.pos += 1; }
    setInt8(value: number)  { this.view.setInt8(this.pos, value);        this.pos += 1; }
    setInt16(value: number) { this.view.setInt16(this.pos, value, true); this.pos += 2; }
    setInt32(value: number) { this.view.setInt32(this.pos, value, true); this.pos += 4; }

    setFloat32(value: number) { this.view.setFloat32(this.pos, value, true); this.pos += 4; }

    setBytes(value: Uint8Array) {
        const v = this.getView(value.length);
        new Uint8Array(v.buffer, v.byteOffset, v.byteLength).set(value);
    }
}

/** .NET BinaryWriter.Write(string) 的编码结果 */
function encodeDotNetString(s: string) {
    const utf8 = new TextEncoder().encode(s);
    const prefix: number[] = [];
    let length = utf8.length;
    do {
        let b = length & 0x7F;
        length >>>= 7;
        if (length > 0)
            b |= 0x80;
        prefix.push(b);
    } while (length > 0);
    const result = new Uint8Array(prefix.length + utf8.length);
    result.set(prefix);
    result.set(utf8, prefix.length);
    return result;
}

function btoUint8Array(b: string) {
    const arr = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) {
        arr[i] = b.charCodeAt(i);
    }
    return arr;
}

function Uint8ArrayTob(a: Uint8Array) {
    let out = '';
    for (let i = 0; i < a.length; i++) {
        out += String.fromCharCode(a[i]);
    }
    return out;
}

const uint8ToHex = new Array(0x100);
for (let i = 0; i < uint8ToHex.length; i++) {
    uint8ToHex[i] = i.toString(16).toUpperCase().padStart(2, '0');
}
function hex(buffer: ArrayBuffer) {
    const view = new Uint8Array(buffer);
    const hexBytes = new Array(view.length);
    for (let i = 0; i < view.length; i++) {
        hexBytes[i] = uint8ToHex[view[i]];
    }
    return hexBytes.join('');
}

function importArea(r: BufferReader): BlueprintArea {
    return {
        index: r.getInt8(),
        parentIndex: r.getInt8(),
        tropicAnchor: r.getInt16(),
        areaSegments: r.getInt16(),
        anchorLocalOffset: {
            x: r.getInt16(),
            y: r.getInt16(),
        },
        size: {
            x: r.getInt16(),
            y: r.getInt16(),
        },
    }
}

function exportArea(w: BufferWriter, area: BlueprintArea) {
    w.setInt8(area.index);
    w.setInt8(area.parentIndex);
    w.setInt16(area.tropicAnchor);
    w.setInt16(area.areaSegments);
    w.setInt16(area.anchorLocalOffset.x);
    w.setInt16(area.anchorLocalOffset.y);
    w.setInt16(area.size.x);
    w.setInt16(area.size.y);
}

interface ParamParser<TParam extends AllParameters> {
    encodedSize(p: TParam): number;
    encode(p: TParam, a: DataView): void;
    decode(a: DataView): TParam;
}

function getParam(v: DataView, pos: number, defaultValue?: number) {
    const p = pos * Int32Array.BYTES_PER_ELEMENT;
    if (p >= v.byteLength) {
        if (defaultValue === undefined) {
            throw new Error('参数解析错误：数据段太短');
        } else {
            return defaultValue;
        }
    }
    return v.getInt32(p, true);
}
function setParam(v: DataView, pos: number, value: number) {
    v.setInt32(pos * Int32Array.BYTES_PER_ELEMENT, value, true);
}

const stationDesc = {
    maxItemKind: 4,
    numSlots: 12,
};
const interstellarStationDesc = {
    maxItemKind: 5,
    numSlots: 12,
};
const AdvancedMiningMachineDesc = {
    maxItemKind: 1,
    numSlots: 9,
};

export enum IODir { None, Output, Input, }
export enum LogisticRole { None, Supply, Demand, }
export interface StationParameters {
    storage: {
        itemId: number;
        max: number;
        localLogic: LogisticRole;
        remoteLogic: LogisticRole;
        // 0: 不锁定，否则将库存容量锁定为max/keepMode
        keepMode: number;
    }[];
    slots: {
        dir: IODir;
        /** Index into storage. Start from 1 */
        storageIdx: number;
    }[];

    workEnergyPerTick: number;
    tripRangeOfDrones: number;
    tripRangeOfShips: number;
    includeOrbitCollector: boolean;
    warpEnableDistance: number;
    warperNecessary: boolean;
    deliveryAmountOfDrones: number;
    deliveryAmountOfShips: number;
    pilerCount: number;
    droneAutoReplenish: boolean;
    shipAutoReplenish: boolean;
}
export interface AdvancedMiningMachineParameters extends StationParameters {
    miningSpeed: number;
}

const stationParamsMeta = {
    base: 320,
    storage: { base: 0, stride: 6 },
    slots: { base: 192, stride: 4 },
} as const;
function stationParamsParser(desc: typeof stationDesc): ParamParser<StationParameters> {
    return {
        encodedSize() { return 2048; },
        encode(p, a) {
            const base = stationParamsMeta.base;
            setParam(a, base + 0, p.workEnergyPerTick);
            setParam(a, base + 1, p.tripRangeOfDrones * 100000000.0);
            setParam(a, base + 2, p.tripRangeOfShips / 100.0);
            setParam(a, base + 3, p.includeOrbitCollector ? 1 : -1);
            setParam(a, base + 4, p.warpEnableDistance);
            setParam(a, base + 5, p.warperNecessary ? 1 : -1);
            setParam(a, base + 6, p.deliveryAmountOfDrones);
            setParam(a, base + 7, p.deliveryAmountOfShips);
            setParam(a, base + 8, p.pilerCount);
            setParam(a, base + 10, p.droneAutoReplenish ? 1 : 0);
            setParam(a, base + 11, p.shipAutoReplenish ? 1 : 0);
            {
                const {base, stride} = stationParamsMeta.storage;
                for (let i = 0; i < desc.maxItemKind; i++) {
                    const s = p.storage[i];
                    setParam(a, base + i * stride + 0, s.itemId);
                    setParam(a, base + i * stride + 1, s.localLogic);
                    setParam(a, base + i * stride + 2, s.remoteLogic);
                    setParam(a, base + i * stride + 3, s.max);
                    setParam(a, base + i * stride + 4, s.keepMode);
                }
            } {
                const {base, stride} = stationParamsMeta.slots;
                for (let i = 0; i < 12; i++) {
                    const s = p.slots[i];
                    setParam(a, base + i * stride + 0, s.dir);
                    setParam(a, base + i * stride + 1, s.storageIdx);
                }
            }
        },
        decode(a) {
            const base = stationParamsMeta.base;
            const result: StationParameters = {
                storage: [],
                slots: [],
                workEnergyPerTick:      getParam(a, base + 0),
                tripRangeOfDrones:      getParam(a, base + 1) / 100000000.0,
                tripRangeOfShips:       getParam(a, base + 2) * 100.0,
                includeOrbitCollector:  getParam(a, base + 3) > 0,
                warpEnableDistance:     getParam(a, base + 4),
                warperNecessary:        getParam(a, base + 5) > 0,
                deliveryAmountOfDrones: getParam(a, base + 6),
                deliveryAmountOfShips:  getParam(a, base + 7),
                pilerCount:             getParam(a, base + 8),
                droneAutoReplenish:     getParam(a, base + 10) > 0,
                shipAutoReplenish:      getParam(a, base + 11) > 0,
            };
            {
                const {base, stride} = stationParamsMeta.storage;
                for (let i = 0; i < desc.maxItemKind; i++) {
                    result.storage.push({
                        itemId:     getParam(a, base + i * stride + 0),
                        localLogic:  getParam(a, base + i * stride + 1),
                        remoteLogic: getParam(a, base + i * stride + 2),
                        max:        getParam(a, base + i * stride + 3),
                        keepMode:   getParam(a, base + i * stride + 4),
                    });
                }
            } {
                const {base, stride} = stationParamsMeta.slots;
                for (let i = 0; i < 12; i++) {
                    result.slots.push({
                        dir:        getParam(a, base + i * stride + 0),
                        storageIdx: getParam(a, base + i * stride + 1),
                    })
                }
            }
            return result;
        }
    }
}

function advancedMiningMachineParamParser(): ParamParser<AdvancedMiningMachineParameters> {
    const stationParser = stationParamsParser(AdvancedMiningMachineDesc);
    return {
        encodedSize: stationParser.encodedSize,
        encode(p, a) {
            stationParser.encode(p, a);
            const base = stationParamsMeta.base;
            setParam(a, base + 9, p.miningSpeed);
        },
        decode(a) {
            const p = stationParser.decode(a);
            const base = stationParamsMeta.base;
            return Object.assign(p, {
                miningSpeed: getParam(a, base + 9),
            });
        }
    }
}

export interface SplitterParameters {
    priority: boolean[];
}

const splitterParamParser: ParamParser<SplitterParameters> = {
    encodedSize() { return 4; },
    encode(p, a) {
        for (let i = 0; i < 4; i++) {
            setParam(a, i, p.priority[i] ? 1 : 0);
        }
    },
    decode(a) {
        const result: SplitterParameters = {
            priority: [],
        };
        for (let i = 0; i < 4; i++) {
            result.priority[i] = getParam(a, i) > 0;
        }
        return result;
    }
}

export enum AcceleratorMode { ExtraOutput, Accelerate }
export enum ResearchMode { None, Compose, Research }

export interface AssembleParamerters {
    acceleratorMode: AcceleratorMode,
}

export interface LabParamerters extends AssembleParamerters {
    researchMode: ResearchMode,
}

const labParamParser: ParamParser<LabParamerters> = {
    encodedSize() { return 2; },
    encode(p, a) {
        setParam(a, 0, p.researchMode);
        setParam(a, 1, p.acceleratorMode);
    },
    decode(a) {
        return {
            researchMode: getParam(a, 0),
            acceleratorMode: getParam(a, 1),
        }
    }
}

const assembleParamParser: ParamParser<AssembleParamerters> = {
    encodedSize() { return 1; },
    encode(p, a) {
        setParam(a, 0, p.acceleratorMode);
    },
    decode(a) {
        return {
            acceleratorMode: getParam(a, 0),
        };
    },
}

export interface BeltParameters {
    iconId: number;
    count: number;
}

const beltParamParser: ParamParser<BeltParameters> = {
    encodedSize() { return 2; },
    encode(p, a) {
        setParam(a, 0, p.iconId);
        setParam(a, 1, p.count);
    },
    decode(a) {
        return {
            iconId: getParam(a, 0),
            count: getParam(a, 1, 0),
        };
    },
}

export interface InserterParameters {
    length: number;
}

const inserterParamParser: ParamParser<InserterParameters> = {
    encodedSize() { return 1; },
    encode(p, a) {
        setParam(a, 0, p.length);
    },
    decode(a) {
        return {
            length: getParam(a, 0),
        };
    },
}

export interface TankParameters {
    input: boolean;
    output: boolean;
}

const tankParamParser: ParamParser<TankParameters> = {
    encodedSize() { return 2; },
    encode(p, a) {
        setParam(a, 0, p.output ? 1 : -1);
        setParam(a, 1, p.input ? 1 : -1);
    },
    decode(a) {
        return {
            output: getParam(a, 0) > 0,
            input: getParam(a, 1) > 0,
        };
    },
}

export enum StorageType {
    DEFAULT = 0,
    FILTERED = 9,
}
export interface StorageGrid {
    filter: number;
}
export interface StorageParameters {
    automationLimit: number;
    type: StorageType;
    grids: StorageGrid[];
}

function storageParamParser(size: number): ParamParser<StorageParameters>{
    return {
        encodedSize() {
            const s = 10 + size;
            if (s < 110)
                return 110;
            return s;
        },
        encode(p, a) {
            setParam(a, 0, p.automationLimit);
            setParam(a, 1, p.type);
            if (p.type === StorageType.FILTERED) {
                for (let i = 0; i < size; i++) {
                    setParam(a, 10 + i, p.grids[i].filter);
                }
            }
        },
        decode(a) {
            const type = getParam(a, 1, StorageType.DEFAULT)
            const grids: StorageGrid[] = [];
            if (type === StorageType.FILTERED) {
                for (let i = 0; i < size; i++) {
                    grids.push({
                        filter: getParam(a, 10 + i, 0),
                    });
                }
            }
            return {
                automationLimit: getParam(a, 0),
                type,
                grids,
            };
        },
    }
}

export enum BattleBaseDroneConstructPriority {
    REPARE = 0,
    BALANCE = 1,
    CONSTRUCT = 2,
}
export interface Fighter {
    itemId: number;
}
export interface BattleBaseParameters extends StorageParameters {
    workEnergyPerTick: number;
    autoPickEnabled: boolean;
    autoReplenishFleet: boolean;
    combatEnabled: boolean;
    autoReconstruct: boolean;
    constructionDroneEnabled: boolean;
    droneConstructPriority: BattleBaseDroneConstructPriority;
    fighters: Fighter[];
}

function battleBaseParamParser(): ParamParser<BattleBaseParameters> {
    const storageParser = storageParamParser(60);
    const getBase = (p: StorageParameters) => {
        switch (p.type) {
            case StorageType.DEFAULT:
                return 10;
            case StorageType.FILTERED:
                return 10 + 60;
            default:
                throw new Error('参数解析错误：未知的储存类型');
        }
    }
    return {
        encodedSize() {
            return 110;
        },
        encode(p, a) {
            storageParser.encode(p, a);
            const base = getBase(p);
            setParam(a, base + 0, p.workEnergyPerTick);
            setParam(a, base + 1, p.autoPickEnabled ? 1 : 0);
            setParam(a, base + 2, p.autoReplenishFleet ? 1 : 0);
            setParam(a, base + 3, p.combatEnabled ? 1 : 0);
            setParam(a, base + 4, p.autoReconstruct ? 1 : 0);
            setParam(a, base + 5, p.constructionDroneEnabled ? 1 : 0);
            setParam(a, base + 6, p.droneConstructPriority);
            for (let i = 0; i < p.fighters.length; i++) {
                setParam(a, base + 7 + i, p.fighters[i].itemId);
            }
        },
        decode(a) {
            const p = storageParser.decode(a);
            const base = getBase(p);
            const fighters: Fighter[] = [];
            for (let i = 0; i < 12; i++) {
                fighters.push({
                    itemId: getParam(a, base + 7 + i),
                });
            }
            return Object.assign(p, {
                workEnergyPerTick: getParam(a, base + 0),
                autoPickEnabled: getParam(a, base + 1) > 0,
                autoReplenishFleet: getParam(a, base + 2) > 0,
                combatEnabled: getParam(a, base + 3) > 0,
                autoReconstruct: getParam(a, base + 4) > 0,
                constructionDroneEnabled: getParam(a, base + 5) > 0,
                droneConstructPriority: getParam(a, base + 6),
                fighters,
            });
        },
    }
}

export interface EjectorParameters {
    orbitId: number;
    boost: boolean;
}

const ejectorParamParser: ParamParser<EjectorParameters> = {
    encodedSize() { return 2; },
    encode(p, a) {
        setParam(a, 0, p.orbitId);
        setParam(a, 1, p.boost ? 1 : 0);
    },
    decode(a) {
        return {
            orbitId: getParam(a, 0),
            boost: getParam(a, 1, 0) > 0,
        };
    },
}

export interface PowerGeneratorParameters {
    productId: number;
}

const powerGeneratorParamParser: ParamParser<PowerGeneratorParameters> = {
    encodedSize() { return 1; },
    encode(p, a) {
        setParam(a, 0, p.productId);
    },
    decode(a) {
        return {
            productId: getParam(a, 0),
        };
    },
}

export interface ArtifacialStarParameters {
    boost: boolean;
}

const artifacialStarParamParser: ParamParser<ArtifacialStarParameters> = {
    encodedSize() { return 1; },
    encode(p, a) {
        setParam(a, 0, p.boost ? 1 : 0);
    },
    decode(a) {
        return {
            boost: getParam(a, 0, 0) > 0,
        };
    },
}

export enum EnergyExchangerMode {
    Discharge = -1,
    StandBy = 0,
    Charge = 1,
}

export interface EnergyExchangerParameters {
    mode: EnergyExchangerMode;
}

const energyExchangerParamParser: ParamParser<EnergyExchangerParameters> = {
    encodedSize() { return 1; },
    encode(p, a) {
        setParam(a, 0, p.mode);
    },
    decode(a) {
        return {
            mode: getParam(a, 0),
        };
    },
}

export enum SpawnItemOperator {
    NONE = 0,
    GENERATE = 1,
    CONSUME = 2,
}
export interface MonitorParameters {
    targetBeltId: number;
    offset: number;
    targetCargoAmount: number;
    periodTicksCount: number;
    passColorId: number;
    failColorId: number;
    passOperator: number;
    alarmMode: number;
    cargoFilter: number;
    systemWarningMode: number;
    systemWarningIconId: number;
    tone: number;
    volume: number;
    pitch: number;
    repeat: boolean;
    length: number;
    falloffRadius: [number, number];
    spawnItemOperator: SpawnItemOperator;
}

const MonitorParamParser: ParamParser<MonitorParameters> = {
    encodedSize() { return 128; },
    encode(p, a) {
        setParam(a, 0, p.targetBeltId);
        setParam(a, 1, p.offset);
        setParam(a, 2, p.targetCargoAmount);
        setParam(a, 3, p.periodTicksCount);
        setParam(a, 4, p.passOperator);
        setParam(a, 5, p.passColorId);
        setParam(a, 6, p.failColorId);
        setParam(a, 14, p.cargoFilter);

        setParam(a, 7, p.tone);
        setParam(a, 8, p.volume);
        setParam(a, 9, p.pitch);
        setParam(a, 11, p.repeat ? 1 : 0);
        setParam(a, 13, p.length * 10000);
        setParam(a, 18, p.falloffRadius[0] * 10);
        setParam(a, 19, p.falloffRadius[1] * 10);

        setParam(a, 10, p.systemWarningMode);
        setParam(a, 17, p.systemWarningIconId);
        setParam(a, 12, p.alarmMode);

        setParam(a, 20, p.spawnItemOperator);
    },
    decode(a) {
        return {
            targetBeltId: getParam(a, 0),
            offset: getParam(a, 1),
            targetCargoAmount: getParam(a, 2),
            periodTicksCount: getParam(a, 3),
            passOperator: getParam(a, 4),
            passColorId: getParam(a, 5),
            failColorId: getParam(a, 6),
            cargoFilter: getParam(a, 14),

            tone: getParam(a, 7),
            volume: getParam(a, 8),
            pitch: getParam(a, 9),
            repeat: getParam(a, 11) > 0,
            length: getParam(a, 13) / 10000,
            falloffRadius: [getParam(a, 18) / 10, getParam(a, 19) / 10],

            systemWarningMode: getParam(a, 10),
            systemWarningIconId: getParam(a, 17),
            alarmMode: getParam(a, 12),

            spawnItemOperator: getParam(a, 20),
        }
    }
}

export enum DispenserPlayerMode {
    NONE = 0,
    RECYCLE = 1,
    BOTH = 2,
    SUPPLY = 3,
}
export enum DispenserStorageMode {
    NONE = 0,
    SUPPLY = 1,
    DEMAND = 2,
}
export interface DispenserParameters {
    playerMode: DispenserPlayerMode;
    storageMode: DispenserStorageMode;
    workEnergyPerTick: number;
    courierAutoReplenish: boolean;
}

const dispenserParamParser: ParamParser<DispenserParameters> = {
    encodedSize() { return 128; },
    encode(p, a) {
        setParam(a, 0, p.playerMode);
        setParam(a, 1, p.storageMode);
        setParam(a, 2, p.workEnergyPerTick);
        setParam(a, 3, p.courierAutoReplenish ? 1 : 0);
    },
    decode(a) {
        return {
            playerMode: getParam(a, 0),
            storageMode: getParam(a, 1),
            workEnergyPerTick: getParam(a, 2),
            courierAutoReplenish: getParam(a, 3) > 0,
        }
    }
}

interface UnknownParamerters {
    parameters: Int32Array,
}

const unknownParamParser: ParamParser<UnknownParamerters> = {
    encodedSize(p) { return p.parameters.length; },
    encode(p, a) {
        for (let i = 0; i < p.parameters.length; i++)
            setParam(a, i, p.parameters[i]);
    },
    decode(a) {
        const p: UnknownParamerters = {
            parameters: new Int32Array(a.byteLength / Int32Array.BYTES_PER_ELEMENT),
        };
        for (let i = 0; i < p.parameters.length; i++)
            p.parameters[i] = getParam(a, i);
        return p;
    },
}

/** 激光灯塔（Marker）参数，布局见 BuildingParameters 的 Marker 分支 */
export interface MarkerParameters {
    color: number;
    height: number;
    radius: number;
    visibility: number;
    detailLevel: number;
    icon: number;
    digitalSignalId: number;
    dfAttractionFlags: number;
    /** 注释每个字符的颜色索引，长度即注释长度（参数 [47]） */
    contentColorIndex: number[];
    /** 完整参数块的拷贝，保证未解析的槽位导出时不丢失 */
    raw: Int32Array;
}

const MARKER_COMMENT_LENGTH = 47;
const MARKER_COMMENT_COLORS = 48;

const markerParamParser: ParamParser<MarkerParameters> = {
    encodedSize(p) { return p.raw.length; },
    encode(p, a) {
        for (let i = 0; i < p.raw.length; i++)
            setParam(a, i, p.raw[i]);
        setParam(a, 0, p.color);
        setParam(a, 1, Math.round(p.height * 100));
        setParam(a, 2, Math.round(p.radius * 100));
        setParam(a, 3, p.visibility);
        setParam(a, 4, p.detailLevel);
        setParam(a, 5, p.icon);
        setParam(a, 6, p.digitalSignalId);
        setParam(a, 7, p.dfAttractionFlags);
        const n = p.contentColorIndex.length;
        setParam(a, MARKER_COMMENT_LENGTH, n);
        for (let i = 0; i < n; i++)
            setParam(a, MARKER_COMMENT_COLORS + i, p.contentColorIndex[i]);
    },
    decode(a) {
        const raw = new Int32Array(a.byteLength / Int32Array.BYTES_PER_ELEMENT);
        for (let i = 0; i < raw.length; i++)
            raw[i] = getParam(a, i);
        const n = Math.max(0, Math.min(getParam(a, MARKER_COMMENT_LENGTH), raw.length - MARKER_COMMENT_COLORS));
        const contentColorIndex: number[] = [];
        for (let i = 0; i < n; i++)
            contentColorIndex.push(raw[MARKER_COMMENT_COLORS + i]);
        return {
            color: raw[0],
            height: raw[1] / 100,
            radius: raw[2] / 100,
            visibility: raw[3],
            detailLevel: raw[4],
            icon: raw[5],
            digitalSignalId: raw[6],
            dfAttractionFlags: raw[7],
            contentColorIndex,
            raw,
        };
    },
}

/** 轨道采集器：按 station 布局解析；全 0 参数块（游戏不写入任何内容）原样保留 */
export interface CollectorParameters extends StationParameters {
    /** 参数块全为 0 时为 true，此时导出写回全 0，面板不显示 */
    allZero: boolean;
    /** 原始参数块的 int32 数量 */
    length: number;
}

function collectorParamParser(): ParamParser<CollectorParameters> {
    const station = stationParamsParser(stationDesc);
    return {
        encodedSize(p) { return p.allZero ? p.length : station.encodedSize(p); },
        encode(p, a) {
            if (p.allZero) {
                for (let i = 0; i < p.length; i++)
                    setParam(a, i, 0);
                return;
            }
            station.encode(p, a);
        },
        decode(a) {
            const length = a.byteLength / Int32Array.BYTES_PER_ELEMENT;
            let allZero = true;
            for (let i = 0; i < length && allZero; i++)
                allZero = getParam(a, i) === 0;
            // 全 0 时用 2048 个 0 解出占位字段，避免短数据段报错
            const view = allZero ? new DataView(new ArrayBuffer(2048 * Int32Array.BYTES_PER_ELEMENT)) : a;
            return { ...station.decode(view), allZero, length };
        },
    };
}

const MARKER_CONTENT_SPLITTER = '\n';

export interface MarkerContent {
    word: string;
    tags: string;
    name: string;
    comment: string;
}

function contentEscape(s: string) {
    return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function contentUnescape(s: string) {
    let r = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '\\' && i < s.length - 1) {
            i++;
            r += s[i] === 'n' ? '\n' : s[i] === '\\' ? '\\' : '\\' + s[i];
        } else {
            r += s[i];
        }
    }
    return r;
}

/** BuildingParameters.content（Marker）：word/tags/name/comment 以换行分隔，各段经 ContentEscape */
export function parseMarkerContent(content: string): MarkerContent {
    const parts = content.split(MARKER_CONTENT_SPLITTER);
    // 与 C# Split(sep, 4) 一致：第 4 段保留其余部分
    const comment = parts.slice(3).join(MARKER_CONTENT_SPLITTER);
    return {
        word: contentUnescape(parts[0] ?? ''),
        tags: contentUnescape(parts[1] ?? ''),
        name: contentUnescape(parts[2] ?? ''),
        comment: contentUnescape(comment),
    };
}

export function joinMarkerContent(c: MarkerContent) {
    return [c.word, c.tags, c.name, c.comment].map(contentEscape).join(MARKER_CONTENT_SPLITTER);
}

type AllParameters = MarkerParameters | CollectorParameters | AssembleParamerters | StationParameters | AdvancedMiningMachineParameters |
    SplitterParameters | LabParamerters | BeltParameters | InserterParameters |
    TankParameters | StorageParameters | EjectorParameters |
    PowerGeneratorParameters | ArtifacialStarParameters | EnergyExchangerParameters |
    MonitorParameters | BattleBaseParameters | DispenserParameters | UnknownParamerters;

const parameterParsers = new Map<number, ParamParser<AllParameters>>([
    [2103, stationParamsParser(stationDesc)],
    [2104, stationParamsParser(interstellarStationDesc)],
    [2316, advancedMiningMachineParamParser()],
    [2020, splitterParamParser],
    [2901, labParamParser],
    [2902, labParamParser],
    [2001, beltParamParser],
    [2002, beltParamParser],
    [2003, beltParamParser],
    [2011, inserterParamParser],
    [2012, inserterParamParser],
    [2013, inserterParamParser],
    [2014, inserterParamParser],
    [2101, storageParamParser(30)],
    [2102, storageParamParser(60)],
    [2106, tankParamParser],
    [2311, ejectorParamParser],
    [2208, powerGeneratorParamParser],
    [2210, artifacialStarParamParser],
    [2209, energyExchangerParamParser],
    [2030, MonitorParamParser],
    [3009, battleBaseParamParser()],
    [2107, dispenserParamParser],
    [2105, collectorParamParser()],
    [2401, markerParamParser],
]);
for (const id of allAssemblers) {
    if (!parameterParsers.has(id))
        parameterParsers.set(id, assembleParamParser);
}

function parserFor(itemId: number) {
    const parser = parameterParsers.get(itemId);
    if (parser !== undefined)
        return parser;
    return unknownParamParser;
}

/** 传送带：0.10.32+ 额外记录 tilt */
function isBelt(itemId: number) { return itemId > 2000 && itemId < 2010; }
/** 分拣器：0.10.32+ 额外记录两端的 tilt/pitch/位置/yaw */
function isInserter(itemId: number) { return itemId > 2010 && itemId < 2020; }

/** 当前游戏导出的建筑记录版本（0.10.34+） */
const BUILDING_VERSION = -102;

function importBuilding(r: BufferReader): BlueprintBuilding {
    function readXYZ() {
        return {
            x: r.getFloat32(),
            y: r.getFloat32(),
            z: r.getFloat32(),
        }
    }
    const tag = r.getInt32();
    let b: BlueprintBuilding;
    if (tag <= -101) {
        // -101: 0.10.32 起；-102: 0.10.34 起，在 -101 基础上末尾追加 content
        const index = r.getInt32();
        const itemId = r.getInt16();
        const modelIndex = r.getInt16();
        const areaIndex = r.getInt8();
        const offset = readXYZ();
        const yaw = r.getFloat32();
        let localOffset: [XYZ, XYZ] = [offset, { ...offset }];
        let yaws: [number, number] = [yaw, yaw];
        let tilt: [number, number] = [0, 0];
        let pitch: [number, number] = [0, 0];
        if (isBelt(itemId)) {
            const t = r.getFloat32();
            tilt = [t, t];
        } else if (isInserter(itemId)) {
            const t = r.getFloat32();
            const p = r.getFloat32();
            const offset2 = readXYZ();
            const yaw2 = r.getFloat32();
            const t2 = r.getFloat32();
            const p2 = r.getFloat32();
            localOffset = [offset, offset2];
            yaws = [yaw, yaw2];
            tilt = [t, t2];
            pitch = [p, p2];
        }
        b = {
            index,
            areaIndex,
            localOffset,
            yaw: yaws,
            tilt,
            pitch,
            itemId,
            modelIndex,
            outputObjIdx: r.getInt32(),
            inputObjIdx: r.getInt32(),
            outputToSlot: r.getInt8(),
            inputFromSlot: r.getInt8(),
            outputFromSlot: r.getInt8(),
            inputToSlot: r.getInt8(),
            outputOffset: r.getInt8(),
            inputOffset: r.getInt8(),
            recipeId: r.getInt16(),
            filterId: r.getInt16(),
            parameters: null,
            content: null,
        };
    } else {
        // -100: 0.10.x 早期，多一个 tilt；>= 0: 旧版本，tag 即 index
        const v100 = tag <= -100;
        const index = v100 ? r.getInt32() : tag;
        const areaIndex = r.getInt8();
        const localOffset: [XYZ, XYZ] = [readXYZ(), readXYZ()];
        const yaw: [number, number] = [r.getFloat32(), r.getFloat32()];
        const tilt = v100 ? r.getFloat32() : 0;
        b = {
            index,
            areaIndex,
            localOffset,
            yaw,
            tilt: [tilt, 0],
            pitch: [0, 0],
            itemId: r.getInt16(),
            modelIndex: r.getInt16(),
            outputObjIdx: r.getInt32(),
            inputObjIdx: r.getInt32(),
            outputToSlot: r.getInt8(),
            inputFromSlot: r.getInt8(),
            outputFromSlot: r.getInt8(),
            inputToSlot: r.getInt8(),
            outputOffset: r.getInt8(),
            inputOffset: r.getInt8(),
            recipeId: r.getInt16(),
            filterId: r.getInt16(),
            parameters: null,
            content: null,
        };
    }
    const length = r.getInt16();
    if (length > 0) {
        const p = r.getView(length * Int32Array.BYTES_PER_ELEMENT);
        b.parameters = parserFor(b.itemId).decode(p);
    }
    if (tag <= -102) {
        if (r.getInt32() > 0)
            b.content = r.getString();
    }
    return b;
}

function exportBuildingSize(b: BlueprintBuilding) {
    let size = 4 + 4 + 2 + 2 + 1 + 12 + 4 // tag, index, itemId, modelIndex, areaIndex, localOffset, yaw
        + 4 + 4 + 6 + 2 + 2 // output/inputObjIdx, slots/offsets, recipeId, filterId
        + 2 // parameter length
        + 4; // content length
    if (isBelt(b.itemId))
        size += 4;
    else if (isInserter(b.itemId))
        size += 4 * 8;
    if (b.parameters !== null)
        size += parserFor(b.itemId).encodedSize(b.parameters) * Int32Array.BYTES_PER_ELEMENT;
    if (b.content)
        size += encodeDotNetString(b.content).length;
    return size;
}

function exportBuilding(w: BufferWriter, b: BlueprintBuilding) {
    function writeXYZ(v: {x: number, y: number, z: number}) {
        w.setFloat32(v.x);
        w.setFloat32(v.y);
        w.setFloat32(v.z);
    }
    w.setInt32(BUILDING_VERSION);
    w.setInt32(b.index);
    w.setInt16(b.itemId);
    w.setInt16(b.modelIndex);
    w.setInt8(b.areaIndex);
    writeXYZ(b.localOffset[0]);
    w.setFloat32(b.yaw[0]);
    if (isBelt(b.itemId)) {
        w.setFloat32(b.tilt[0]);
    } else if (isInserter(b.itemId)) {
        w.setFloat32(b.tilt[0]);
        w.setFloat32(b.pitch[0]);
        writeXYZ(b.localOffset[1]);
        w.setFloat32(b.yaw[1]);
        w.setFloat32(b.tilt[1]);
        w.setFloat32(b.pitch[1]);
    }
    w.setInt32(b.outputObjIdx);
    w.setInt32(b.inputObjIdx);
    w.setInt8(b.outputToSlot);
    w.setInt8(b.inputFromSlot);
    w.setInt8(b.outputFromSlot);
    w.setInt8(b.inputToSlot);
    w.setInt8(b.outputOffset);
    w.setInt8(b.inputOffset);
    w.setInt16(b.recipeId);
    w.setInt16(b.filterId);

    if (b.parameters !== null) {
        const parser = parserFor(b.itemId);
        const length = parser.encodedSize(b.parameters);
        w.setInt16(length);
        parser.encode(b.parameters, w.getView(length * Int32Array.BYTES_PER_ELEMENT));
    } else {
        w.setInt16(0);
    }

    if (b.content) {
        w.setInt32(b.content.length);
        w.setBytes(encodeDotNetString(b.content));
    } else {
        w.setInt32(0);
    }
}

const START = 'BLUEPRINT:';
const TIME_BASE = new Date(0).setUTCFullYear(1);

export function fromStr(strData: string): BlueprintData {
    if (!strData.startsWith(START))
        throw Error('Invalid start');

    const p1 = strData.indexOf('"', START.length);
    const cells = strData.substring(START.length, p1).split(',');
    if (cells.length < 12)
        throw Error('Header too short');
    const patch = parseInt(cells[0]) || 0;
    if (patch >= 1 && cells.length < 15)
        throw Error('Header too short');
    const header = {
        patch,
        layout: parseInt(cells[1]),
        icons: cells.slice(2, 7).map(s => parseInt(s)),
        time: new Date(TIME_BASE + parseInt(cells[8]) / 10000),
        gameVersion: cells[9],
        shortDesc: decodeURIComponent(cells[10]),
        author: patch >= 1 ? decodeURIComponent(cells[11]) : '',
        customVersion: patch >= 1 ? decodeURIComponent(cells[12]) : '',
        externalFields: patch >= 1 ? decodeURIComponent(cells[13]) : '',
        desc: decodeURIComponent(patch >= 1 ? cells[14] : cells[11]),
    }

    const p2 = strData.length - 33;
    if (strData[p2] !== '"')
        throw Error('Checksum not found')
    const d = hex(digest(btoUint8Array(strData.substring(0, p2)).buffer));
    const expectedD = strData.substring(p2 + 1);
    if (d !== expectedD)
        throw Error('Checksum mismatch')

    const encoded = strData.substring(p1 + 1, p2);
    const decoded = pako.ungzip(btoUint8Array(atob(encoded)));
    const reader = new BufferReader(new DataView(decoded.buffer));

    const meta = {
        version: reader.getInt32(),
        cursorOffset: {
            x: reader.getInt32(),
            y: reader.getInt32(),
        },
        cursorTargetArea: reader.getInt32(),
        dragBoxSize: {
            x: reader.getInt32(),
            y: reader.getInt32(),
        },
        primaryAreaIdx: reader.getInt32(),
    };

    const numAreas = reader.getUint8();
    const areas: Array<BlueprintArea> = [];
    for (let i = 0; i < numAreas; i++)
        areas.push(importArea(reader));

    const numBuildings = reader.getInt32();
    const buildings: Array<BlueprintBuilding> = [];
    for (let i = 0; i < numBuildings; i++)
        buildings.push(importBuilding(reader));

    const tail = reader.getBytes(reader.remaining());

    return {
        header,
        ...meta,
        areas,
        buildings,
        tail,
    };
}

export function toStr(bp: BlueprintData): string {
    const patch = bp.header.patch;
    let result = START;
    result += patch;
    result += ',';
    result += bp.header.layout;
    result += ',';
    for (const i of bp.header.icons) {
        result += i;
        result += ',';
    }
    result += '0,';
    result += (bp.header.time.getTime() - TIME_BASE) * 10000;
    result += ',';
    result += bp.header.gameVersion;
    result += ',';
    result += encodeURIComponent(bp.header.shortDesc);
    result += ',';
    if (patch >= 1) {
        result += encodeURIComponent(bp.header.author);
        result += ',';
        result += encodeURIComponent(bp.header.customVersion);
        result += ',';
        result += encodeURIComponent(bp.header.externalFields);
        result += ',';
    }
    result += encodeURIComponent(bp.header.desc);
    result += '"';

    // 建筑统一按当前游戏格式（-102）导出；Version 与尾部原样保留，
    // 避免旧蓝图（Version<1）跳过游戏的 DataRepair，或丢失 0.10.33+ 的地基数据
    const tail = bp.tail;
    let size = 28 // meta
        + 1 // numAreas
        + 14 * bp.areas.length
        + 4 // numBuildings
        + tail.length;
    for (const b of bp.buildings)
        size += exportBuildingSize(b);

    const decoded = new Uint8Array(size);
    const writer = new BufferWriter(new DataView(decoded.buffer));
    writer.setInt32(bp.version);
    writer.setInt32(bp.cursorOffset.x);
    writer.setInt32(bp.cursorOffset.y);
    writer.setInt32(bp.cursorTargetArea);
    writer.setInt32(bp.dragBoxSize.x);
    writer.setInt32(bp.dragBoxSize.y);
    writer.setInt32(bp.primaryAreaIdx);

    writer.setUint8(bp.areas.length);
    for (const a of bp.areas)
        exportArea(writer, a);

    writer.setInt32(bp.buildings.length);
    for (const b of bp.buildings)
        exportBuilding(writer, b);
    writer.setBytes(tail);

    result += btoa(Uint8ArrayTob(pako.gzip(decoded)));
    const d = hex(digest(btoUint8Array(result).buffer));

    result += '"'
    result += d;

    return result;
}
