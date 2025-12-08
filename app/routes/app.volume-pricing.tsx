import { useState } from "react";
import type {
    ActionFunctionArgs,
    HeadersFunction,
    LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useNavigate, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    console.log("\n========================================");
    console.log("🎯 HIT: app.volume-pricing.tsx LOADER");
    console.log("📍 URL:", url.pathname + url.search);
    console.log("========================================\n");

    await authenticate.admin(request);

    return {
        functionId: process.env.SHOPIFY_VOLUME_LOGIC_ID,
    };
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const functionId = process.env.SHOPIFY_VOLUME_LOGIC_ID;

    if (!functionId) {
        return { error: "Function ID not configured" };
    }

    // Create the discount using the volume function
    const response = await admin.graphql(
        `#graphql
      mutation CreateAutomaticDiscount($discount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $discount) {
          automaticAppDiscount {
            discountId
            title
            startsAt
          }
          userErrors {
            field
            message
          }
        }
      }`,
        {
            variables: {
                discount: {
                    title: "Volume Discount",
                    functionId: functionId,
                    startsAt: new Date().toISOString(),
                },
            },
        }
    );

    const responseJson = await response.json();
    const userErrors = responseJson.data?.discountAutomaticAppCreate?.userErrors;

    if (userErrors && userErrors.length > 0) {
        return { error: userErrors[0].message };
    }

    return { success: true };
};

export default function VolumeLogic() {
    const { functionId } = useLoaderData<typeof loader>();
    const submit = useSubmit();
    const navigate = useNavigate();
    const shopify = useAppBridge();
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        submit({}, { method: "POST" });
    };

    return (
        <s-page heading="Create Native Volume Discount">
            <ui-title-bar title="Create Native Volume Discount">
                <button variant="primary" onClick={handleSave} disabled={isSaving}>
                    Save
                </button>
                <button onClick={() => navigate("/app")}>Discounts</button>
            </ui-title-bar>
            <s-section heading="Volume Discount Configuration">
                <s-paragraph>
                    This will create an automatic discount powered by your volume pricing
                    function. The discount will apply based on the quantity thresholds
                    defined in your function logic.
                </s-paragraph>

                {!functionId && (
                    <s-banner tone="warning">
                        Function ID not found. Please run <code>npm run deploy</code> first,
                        then restart the dev server.
                    </s-banner>
                )}

                {functionId && (
                    <s-box
                        padding="base"
                        borderWidth="base"
                        borderRadius="base"
                        background="subdued"
                    >
                        <s-text>Function ID: {functionId}</s-text>
                    </s-box>
                )}
            </s-section>
        </s-page>
    );
}

export const headers: HeadersFunction = (headersArgs) => {
    return boundary.headers(headersArgs);
};
