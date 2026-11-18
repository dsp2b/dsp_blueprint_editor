/** 最近打开列表的图标：取每条记录第一个有效图标并解析成 URL；未知或加载失败的图标记为 ''（不显示） */
export async function recentIconUrls(
    entries: { id: string; icons: number[] }[],
    resolve: (iconId: number) => Promise<string>,
): Promise<Record<string, string>> {
    const pairs = await Promise.all(entries.map(async e => {
        const iconId = e.icons.find(i => i > 0);
        if (!iconId)
            return [e.id, ''] as const;
        try {
            return [e.id, await resolve(iconId)] as const;
        } catch {
            return [e.id, ''] as const;
        }
    }));
    return Object.fromEntries(pairs);
}
