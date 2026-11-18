import * as monaco from 'monaco-editor/editor/editor.main';
import * as yaml from 'monaco-editor/languages/definitions/yaml/yaml';
import * as glue from './entry';

glue.init(monaco, yaml);

export const mount = glue.mount;
export const purge = glue.purge;
