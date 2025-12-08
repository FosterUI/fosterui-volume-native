import { useEffect, useState } from "react";
import type {
    ActionFunctionArgs,
    HeadersFunction,
    LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";


export const loader = async ({ request }: LoaderFunctionArgs) => {
    console.log("[volume-pricing] Loader called, URL:", request.url);
    const { admin } = await authenticate.admin(request);

    // First try environment variable (set by Shopify CLI during dev)
    let functionId = process.env.SHOPIFY_VOLUME_LOGIC_ID;
    console.log("[volume-pricing] Function ID from env:", functionId);

    // If not found, query for it via GraphQL
    if (!functionId) {
        console.log("[volume-pricing] Fetching function ID via GraphQL...");
        try {
            const response = await admin.graphql(
                `#graphql
                query GetShopifyFunctions {
                    shopifyFunctions(first: 25) {
                        nodes {
                            id
                            title
                            apiType
                            app {
                                title
                            }
                        }
                    }
                }`
            );
            const data = await response.json();
            console.log("[volume-pricing] Functions response:", JSON.stringify(data, null, 2));

            // Find our function by looking for the volume-logic function
            const functions = data.data?.shopifyFunctions?.nodes || [];
            const volumeFunction = functions.find((fn: { title?: string; apiType?: string }) =>
                fn.title?.toLowerCase().includes("volume") ||
                fn.apiType === "product_discounts"
            );

            if (volumeFunction) {
                console.log("[volume-pricing] Found function ID:", volumeFunction.id);
                functionId = volumeFunction.id;
            }
        } catch (error) {
            console.error("[volume-pricing] Error fetching functions:", error);
        }
    }

    return {
        functionId,
    };
};

// Helper to fetch function ID via GraphQL
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getFunctionId(admin: any): Promise<string | null> {
    // First try environment variable
    const functionId = process.env.SHOPIFY_VOLUME_LOGIC_ID;
    if (functionId) return functionId;

    // Query via GraphQL
    try {
        const response = await admin.graphql(
            `#graphql
            query GetShopifyFunctions {
                shopifyFunctions(first: 25) {
                    nodes {
                        id
                        title
                        apiType
                    }
                }
            }`
        );
        const data = await response.json();
        const functions = data.data?.shopifyFunctions?.nodes || [];
        const volumeFunction = functions.find((fn: { title?: string; apiType?: string }) =>
            fn.title?.toLowerCase().includes("volume") ||
            fn.apiType === "product_discounts"
        );
        return volumeFunction?.id || null;
    } catch (error) {
        console.error("[volume-pricing] Error fetching functions:", error);
        return null;
    }
}

export const action = async ({ request }: ActionFunctionArgs) => {
    console.log("[volume-pricing] Action called");
    const { admin } = await authenticate.admin(request);
    const functionId = await getFunctionId(admin);

    // Get form data
    const formData = await request.formData();
    const title = formData.get("title") as string || `Volume Discount ${Date.now()}`;

    console.log("[volume-pricing] Function ID:", functionId);
    console.log("[volume-pricing] Title:", title);

    if (!functionId) {
        console.error("[volume-pricing] ERROR: Function ID not configured");
        return { success: false, error: "Function ID not found. Please deploy the extension first." };
    }

    try {
        // Create the discount using the volume function
        console.log("[volume-pricing] Creating discount with functionId:", functionId);
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
                        title: title,
                        functionId: functionId,
                        startsAt: new Date().toISOString(),
                        discountClasses: ["PRODUCT"],
                    },
                },
            }
        );

        const responseJson = await response.json();
        console.log("[volume-pricing] GraphQL response:", JSON.stringify(responseJson, null, 2));

        const userErrors = responseJson.data?.discountAutomaticAppCreate?.userErrors;
        const discount = responseJson.data?.discountAutomaticAppCreate?.automaticAppDiscount;

        if (userErrors && userErrors.length > 0) {
            console.error("[volume-pricing] User errors:", userErrors);
            return { success: false, error: userErrors[0].message };
        }

        if (discount) {
            console.log("[volume-pricing] Discount created successfully:", discount);
            return {
                success: true,
                discountId: discount.discountId,
                title: discount.title
            };
        }

        console.error("[volume-pricing] No discount returned and no errors");
        return { success: false, error: "Unknown error occurred" };
    } catch (error) {
        console.error("[volume-pricing] Exception:", error);
        return { success: false, error: String(error) };
    }
};

type ActionData = {
    success: boolean;
    error?: string;
    discountId?: string;
    title?: string;
};

export default function VolumeLogic() {
    const { functionId } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<ActionData>();
    const navigate = useNavigate();
    const shopify = useAppBridge();
    const [title, setTitle] = useState("");

    const isLoading = fetcher.state === "submitting" || fetcher.state === "loading";

    // Handle action response
    useEffect(() => {
        if (fetcher.data) {
            console.log("[volume-pricing] Fetcher data received:", fetcher.data);

            if (fetcher.data.success) {
                shopify.toast.show("Discount created successfully!");
                // Navigate to discounts page after success
                setTimeout(() => {
                    navigate("/app");
                }, 1500);
            } else if (fetcher.data.error) {
                shopify.toast.show(`Error: ${fetcher.data.error}`, { isError: true });
            }
        }
    }, [fetcher.data, shopify, navigate]);

    const handleSave = () => {
        console.log("[volume-pricing] Save clicked, submitting...");
        fetcher.submit({ title: title || `Volume Discount ${Date.now()}` }, { method: "POST" });
    };

    return (
        <s-page heading="Create Native Volume Discount">
            <ui-title-bar title="Create Native Volume Discount">
                <button variant="primary" onClick={handleSave} disabled={isLoading || !functionId}>
                    {isLoading ? "Saving..." : "Save"}
                </button>
                <button onClick={() => navigate("/app")}>Discounts</button>
            </ui-title-bar>
            <s-section heading="Volume Discount Configuration">
                <s-paragraph>
                    This will create an automatic discount powered by your volume pricing
                    function. The discount will apply based on the quantity thresholds
                    defined in your function logic.
                </s-paragraph>

                <s-box padding-block-end="base">
                    <s-text-field
                        label="Discount Title"
                        value={title}
                        onInput={(e: { currentTarget: { value: string } }) => setTitle(e.currentTarget.value)}
                        placeholder="e.g., Buy 5+ Get 10% Off"
                        help-text="Enter a unique name for this discount"
                    />
                </s-box>

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

                {fetcher.data?.error && (
                    <s-banner tone="critical">
                        {fetcher.data.error}
                    </s-banner>
                )}

                {fetcher.data?.success && (
                    <s-banner tone="success">
                        Discount &quot;{fetcher.data.title}&quot; created successfully! Redirecting...
                    </s-banner>
                )}
            </s-section>
        </s-page>
    );
}

export const headers: HeadersFunction = (headersArgs) => {
    return boundary.headers(headersArgs);
};
