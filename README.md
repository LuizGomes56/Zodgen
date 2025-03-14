## Features

Create a `zodgen.config.json` file and specify properties of the following type:

```ts
type ZodgenConfig = {
	input: {
        name: string,
        file: string,
        rename?: string,
        expand?: boolean,
        export?: boolean
    }[],
	output: string
}[]
```

`name`: Name of the type to be extracted


`file`: Path to the file where the type is defined


`rename`: Name of the type to be used in the output file


`expand`: If true, the type will be expanded to include all properties


`export`: If true, the type will have keyword `export` at the end, in output file

`output`: Path to the output file

## References to other extensions
`@prettify-ts` - used its source code to expand type annotations, with minor modifications 


`@ts-to-zod` - used its source code to convert types to zod schemas

## Requirements

Must have a `zodgen.config.json` file in the **root** of the project

## Extension Settings

* `zodgen.enable`: Enable/disable this extension.
* `zodgen.newSchema`: Generate schema from config file.