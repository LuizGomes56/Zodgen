import * as ts2zod from 'ts-to-zod';
import { ZodgenConfig } from './extension';

export function generateSchema(sourceText: string, source: ZodgenConfig[number]["input"]): string {
    let content = '';
    const result = ts2zod.generate({
        sourceText,
        keepComments: true,
        getSchemaName: (name: string) => name
    });
    if (result.errors && result.errors.length > 0) {
        content = result.errors.map(x => {
            x = x.replace(/\n/g, '\n//');

            return `//${x}`;
        }).join('\n') + '\n\n';
    }

    const schemasFile = result.getZodSchemasFile('')
        .replace(/\/\/ Generated by ts-to-zod/g, '')
        .trim();
    content += schemasFile;

    return content;
}