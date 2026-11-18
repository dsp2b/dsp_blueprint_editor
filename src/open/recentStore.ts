/** 最近打开的蓝图：存在浏览器本地 IndexedDB，保留最近 20 条，可一键清空；不上传。 */
export const RECENT_LIMIT = 20;

export interface RecentInput {
    code: string;
    name: string;
    icons: number[];
}

export interface RecentEntry extends RecentInput {
    id: string;
    openedAt: number;
}

export interface RecentStore {
    list(): Promise<RecentEntry[]>;
    add(item: RecentInput): Promise<void>;
    clear(): Promise<void>;
}

const DB_NAME = 'dsp-blueprint-recent';
const STORE = 'recent';

/** 蓝图代码可达 MB 级，用 cyrb53 摘要+长度做主键，避免把整段代码当 key */
function codeId(code: string): string {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < code.length; i++) {
        const c = code.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `${code.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

const wrap = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
});
const done = (t: IDBTransaction) => new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
});

/** factory 缺省时用浏览器的 indexedDB（不可用时各方法会 reject，由调用方降级） */
export function createRecentStore(factory?: IDBFactory): RecentStore {
    let dbPromise: Promise<IDBDatabase> | null = null;
    let lastStamp = 0;
    const db = () => dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
        const req = (factory ?? indexedDB).open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
            s.createIndex('openedAt', 'openedAt');
        };
        req.onsuccess = () => {
            const conn = req.result;
            // 别的标签页升级数据库时让出连接，下次使用再重新打开
            conn.onversionchange = () => {
                conn.close();
                dbPromise = null;
            };
            resolve(conn);
        };
        req.onerror = () => reject(req.error);
    }).catch(e => {
        // 打开失败不缓存，下次调用重试
        dbPromise = null;
        throw e;
    });

    return {
        async list() {
            const t = (await db()).transaction(STORE, 'readonly');
            const all = await wrap(t.objectStore(STORE).getAll() as IDBRequest<RecentEntry[]>);
            return all.sort((a, b) => b.openedAt - a.openedAt);
        },
        async add(item) {
            // 同一毫秒内多次写入也要保持先后次序
            lastStamp = Math.max(Date.now(), lastStamp + 1);
            const t = (await db()).transaction(STORE, 'readwrite');
            const s = t.objectStore(STORE);
            s.put({ ...item, id: codeId(item.code), openedAt: lastStamp });
            const finished = done(t);
            // 计数或游标先失败时事务也会 abort，避免 finished 的拒绝无人处理
            finished.catch(() => undefined);
            let extra = (await wrap(s.count())) - RECENT_LIMIT;
            if (extra > 0) {
                // 只遍历键（不读取大块代码），按 openedAt 升序删除最旧的
                await new Promise<void>((resolve, reject) => {
                    const cur = s.index('openedAt').openKeyCursor();
                    cur.onerror = () => reject(cur.error);
                    cur.onsuccess = () => {
                        const c = cur.result;
                        if (!c || extra <= 0)
                            return resolve();
                        s.delete(c.primaryKey);
                        extra--;
                        c.continue();
                    };
                });
            }
            await finished;
        },
        async clear() {
            const t = (await db()).transaction(STORE, 'readwrite');
            t.objectStore(STORE).clear();
            await done(t);
        },
    };
}
