/** Production reads and writes always use the AXION API, including on a previously offline tab. */
export const isApi = () => true;
export const hasDemoActivity = (_mission: { demo?: boolean }) => false;
