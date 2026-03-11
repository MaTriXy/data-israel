'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { FreeTextPromptEntry } from '@/convex/analytics';

interface FreeTextPromptsListProps {
    data: FreeTextPromptEntry[];
}

export function FreeTextPromptsList({ data }: FreeTextPromptsListProps) {
    const [search, setSearch] = useState('');

    const filtered = search
        ? data.filter((d) => d.text.toLowerCase().includes(search.toLowerCase()))
        : data;

    return (
        <div>
            <h3 className='mb-3 text-sm font-medium text-muted-foreground'>
                שאילתות חופשיות ({filtered.length})
            </h3>
            <div className='relative mb-3'>
                <Search className='absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none' />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder='חיפוש...'
                    className='pr-10'
                    dir='rtl'
                />
            </div>
            <div className='max-h-[300px] overflow-y-auto rounded-md border divide-y divide-border'>
                {filtered.length === 0 ? (
                    <div className='flex h-20 items-center justify-center text-sm text-muted-foreground'>
                        {search ? 'לא נמצאו תוצאות' : 'אין נתונים'}
                    </div>
                ) : (
                    filtered.map((entry, i) => (
                        <div key={i} className='px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors'>
                            <p className='text-foreground leading-relaxed'>{entry.text}</p>
                            <p className='mt-1 text-xs text-muted-foreground'>
                                {new Date(entry.createdAt).toLocaleString('he-IL', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}
                            </p>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
