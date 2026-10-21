import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
export default {resolve:{alias:{'react-dom':resolve(root,'frontend/node_modules/react-dom'),react:resolve(root,'frontend/node_modules/react')}},server:{fs:{allow:[root]}}};
