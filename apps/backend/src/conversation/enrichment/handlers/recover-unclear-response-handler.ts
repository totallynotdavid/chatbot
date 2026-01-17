import type { EnrichmentRequest, EnrichmentResult } from "@totem/core";
import type { EnrichmentHandler, EnrichmentContext } from "../handler-interface.ts";
import { safeRecoverUnclearResponse } from "../../../intelligence/wrapper.ts";

export class RecoverUnclearResponseHandler
    implements
    EnrichmentHandler<
        Extract<EnrichmentRequest, { type: "recover_unclear_response" }>,
        Extract<EnrichmentResult, { type: "recovery_response" }>
    > {
    readonly type = "recover_unclear_response" as const;

    async execute(
        request: Extract<EnrichmentRequest, { type: "recover_unclear_response" }>,
        context: EnrichmentContext,
    ): Promise<Extract<EnrichmentResult, { type: "recovery_response" }>> {
        const recoveryText = await safeRecoverUnclearResponse(
            context.provider,
            request.message,
            request.context,
            context.phoneNumber,
        );

        return {
            type: "recovery_response",
            text: recoveryText,
        };
    }
}
