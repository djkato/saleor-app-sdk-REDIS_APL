import { NextApiRequest } from "next";

import { APL } from "../../APL";
import { createDebug } from "../../debug";
import { getBaseUrl, getSaleorHeaders } from "../../headers";
import { Permission } from "../../types";
import { extractUserFromJwt } from "../../util/extract-user-from-jwt";
import { verifyJWT } from "../../verify-jwt";
import { ProtectedHandlerContext } from "./protected-handler-context";

const debug = createDebug("processProtectedHandler");

export type SaleorProtectedHandlerError =
  | "OTHER"
  | "MISSING_HOST_HEADER"
  | "MISSING_DOMAIN_HEADER"
  | "MISSING_API_URL_HEADER"
  | "MISSING_AUTHORIZATION_BEARER_HEADER"
  | "NOT_REGISTERED"
  | "JWT_VERIFICATION_FAILED"
  | "NO_APP_ID";

export class ProtectedHandlerError extends Error {
  errorType: SaleorProtectedHandlerError = "OTHER";

  constructor(message: string, errorType: SaleorProtectedHandlerError) {
    super(message);
    if (errorType) {
      this.errorType = errorType;
    }
    Object.setPrototypeOf(this, ProtectedHandlerError.prototype);
  }
}

interface ProcessSaleorProtectedHandlerArgs {
  req: Pick<NextApiRequest, "headers">;
  apl: APL;
  requiredPermissions?: Permission[];
}

type ProcessAsyncSaleorProtectedHandler = (
  props: ProcessSaleorProtectedHandlerArgs
) => Promise<ProtectedHandlerContext>;

/**
 * Perform security checks on given request and return ProtectedHandlerContext object.
 * In case of validation issues, instance of the ProtectedHandlerError will be thrown.
 *
 * Can pass entire next request or Headers with saleorApiUrl and token
 */
export const processSaleorProtectedHandler: ProcessAsyncSaleorProtectedHandler = async ({
  req,
  apl,
  requiredPermissions,
}: ProcessSaleorProtectedHandlerArgs): Promise<ProtectedHandlerContext> => {
  debug("Request processing started");

  const { saleorApiUrl, authorizationBearer: token } = getSaleorHeaders(req.headers);

  const baseUrl = getBaseUrl(req.headers);
  if (!baseUrl) {
    debug("Missing host header");
    throw new ProtectedHandlerError("Missing host header", "MISSING_HOST_HEADER");
  }

  if (!saleorApiUrl) {
    debug("Missing saleor-api-url header");
    throw new ProtectedHandlerError("Missing saleor-api-url header", "MISSING_API_URL_HEADER");
  }

  if (!token) {
    debug("Missing authorization-bearer header");
    throw new ProtectedHandlerError(
      "Missing authorization-bearer header",
      "MISSING_AUTHORIZATION_BEARER_HEADER"
    );
  }

  // Check if API URL has been registered in the APL
  const authData = await apl.get(saleorApiUrl);
  if (!authData) {
    debug("APL didn't found auth data for API URL %s", saleorApiUrl);
    throw new ProtectedHandlerError(
      `Can't find auth data for saleorApiUrl ${saleorApiUrl}. Please register the application`,
      "NOT_REGISTERED"
    );
  }

  try {
    await verifyJWT({ appId: authData.appId, token, saleorApiUrl, requiredPermissions });
  } catch (e) {
    throw new ProtectedHandlerError("JWT verification failed: ", "JWT_VERIFICATION_FAILED");
  }

  const userJwtPayload = extractUserFromJwt(token);

  return {
    baseUrl,
    authData,
    user: userJwtPayload,
  };
};
