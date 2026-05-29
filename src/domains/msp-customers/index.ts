/**
 * MSP-Customers domain — typed customer records + repository.
 *
 * Foundation for the MSP-Bridges (Phase 7-A). Read-side only —
 * customer.yaml are operator-edited files; the GUI may add a Create
 * Customer-Wizard later (Phase 7-E).
 *
 * @module @domains/msp-customers
 */

export {
  CUSTOMER_FILE_NAME,
  customerWorkspaceDir,
  customerYamlPath,
  listCustomerSlugs,
  MSP_CUSTOMERS_WORKSPACES_SUBDIR,
  mspCustomersDir,
} from './paths.js';
export { readCustomerYaml, writeCustomerYaml } from './reader.js';
export { CustomerRepository } from './repository.js';
export { defaultRecord, validateCustomerRecord } from './schema.js';
export {
  CUSTOMER_SLUG_MAX_LEN,
  CUSTOMER_SLUG_REGEX,
  type CustomerContact,
  CustomerNotFoundError,
  type CustomerRecord,
  CustomerSchemaError,
  type M365BridgeIds,
  type SecurepointBridgeIds,
  type SophosBridgeIds,
  type TanssBridgeIds,
  type VeeamBridgeIds,
} from './types.js';
