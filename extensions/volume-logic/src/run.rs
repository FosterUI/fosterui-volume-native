use shopify_function::prelude::*;
use shopify_function::Result;
use serde::{Deserialize, Serialize};

// This macro reads your run.graphql and creates the structs automatically.
generate_types!(
    query_path = "./src/run.graphql",
    schema_path = "./schema.graphql"
);

// We define this struct manually because 'tiers' arrives as a JSON string.
#[derive(Clone, Debug, Deserialize)]
struct TierConfig {
    qty: i64,
    discount: f64,
    label: String,
}

#[shopify_function]
fn function(input: input::ResponseData) -> Result<output::FunctionResult> {
    let mut discounts = vec![];

    // Iterate through cart lines
    for line in input.cart.lines {
        // 1. Ensure it's a Product Variant
        if let input::InputCartLinesMerchandise::ProductVariant(variant) = &line.merchandise {
            
            // 2. Safe Unwrapping: Metafield -> Reference -> Metaobject -> Field
            if let Some(metafield) = &variant.product.volume_discount {
                if let Some(reference) = &metafield.reference {
                    if let input::InputCartLinesMerchandiseProductVolumeDiscountReference::Metaobject(metaobject) = reference {
                        if let Some(tiers_field) = &metaobject.tiers {
                            
                            // 3. Parse the JSON Configuration
                            let config: Vec<TierConfig> = serde_json::from_str(&tiers_field.value).unwrap_or(vec![]);
                            
                            // 4. Find the best tier
                            let mut best_tier: Option<TierConfig> = None;
                            
                            for tier in config {
                                if line.quantity >= tier.qty {
                                    if let Some(current_best) = &best_tier {
                                        if tier.qty > current_best.qty {
                                            best_tier = Some(tier);
                                        }
                                    } else {
                                        best_tier = Some(tier);
                                    }
                                }
                            }

                            // 5. Apply Discount if tier found
                            if let Some(tier) = best_tier {
                                let target = output::Target {
                                    product_variant: Some(output::ProductVariantTarget {
                                        id: variant.id.clone(),
                                        quantity: None,
                                    }),
                                };

                                discounts.push(output::Discount {
                                    value: output::Value {
                                        percentage: Some(output::Percentage {
                                            value: tier.discount.into(),
                                        }),
                                        fixed_amount: None,
                                    },
                                    targets: vec![target],
                                    message: Some(tier.label), 
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(output::FunctionResult {
        discounts,
        discount_application_strategy: output::DiscountApplicationStrategy::MAXIMUM,
    })
}