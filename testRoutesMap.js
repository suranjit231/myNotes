export default async function calculateSortestRoutes(req, res, next) {
    try {
        // Fetch pending orders and populate user data to get user locations
        const orders = await orderModel.find({ orderStatus: "pending" }).populate("user");
        const deliveryLocations = orders
            .map(order => ({
                coordinates: order.user.coordinates,
                quantity: order.quantity
            }))
            .filter(coords => coords.coordinates?.latitude && coords.coordinates?.longitude);

        const parcelCapacity = 30;
        const myInfo = orders.find(order => order.user.email === "namasudrasuranjit164@gmail.com");
        const startingLocation = myInfo?.user?.coordinates || { latitude: 27.4656118, longitude: 94.9022926 };

        // Fetch inventory locations
        const inventories = await inventoryModel.find({}).limit(2);
        const stockLocations = inventories
            .map(inv => inv.coordinates)
            .filter(coords => coords?.latitude && coords?.longitude);

        // Calculate combined distance for each inventory
        const combinedDistances = await Promise.all(stockLocations.map(async (inventory, index) => {
            // Distance from starting location to current inventory
            const distanceToInventory = await getDistances(
                `${startingLocation.latitude},${startingLocation.longitude}`,
                [`${inventory.latitude},${inventory.longitude}`]
            );
            
            // Calculate delivery route distance from the current inventory
            const deliveryDistances = await getDistances(
                `${inventory.latitude},${inventory.longitude}`,
                deliveryLocations.map(loc => `${loc.coordinates.latitude},${loc.coordinates.longitude}`)
            );

            // Sort delivery locations by distance from current inventory
            const sortedDeliveryDistances = deliveryLocations
                .map((loc, i) => ({ location: loc, distance: deliveryDistances[i] }))
                .sort((a, b) => a.distance - b.distance);

            // Sum of distances for delivery route
            const deliveryRouteDistance = sortedDeliveryDistances.reduce((total, loc) => total + loc.distance, 0);
            return {
                inventoryIndex: index,
                combinedDistance: distanceToInventory[0] + deliveryRouteDistance
            };
        }));

        // Choose the inventory with the minimum combined distance
        const bestInventory = combinedDistances.reduce((min, current) => 
            current.combinedDistance < min.combinedDistance ? current : min
        );
        const selectedInventory = stockLocations[bestInventory.inventoryIndex];

        // Calculate optimal delivery and refill routes
        const finalResult = await calculateOptimalRoute({
            deliveryLocations,
            stockLocations,
            parcelCapacity,
            startingLocation,
            initialRefillLocation: selectedInventory
        });

        console.log("Final result: ", finalResult);
        return res.json({ success: true, message: "Final routes calculated successfully!", data: finalResult });
    } catch (error) {
        console.error("Error calculating optimized delivery routes:", error);
        return res.status(500).json({ success: false, message: "Error calculating routes", error: error.message });
    }
}

async function calculateOptimalRoute(data) {
    const { deliveryLocations, stockLocations, parcelCapacity, startingLocation, initialRefillLocation } = data;
    let currentLocation = `${initialRefillLocation.latitude},${initialRefillLocation.longitude}`;
    const routeSteps = [];

    // Start with an initial refill action at the selected inventory
    routeSteps.push({
        action: 'refill',
        coordinates: { latitude: initialRefillLocation.latitude, longitude: initialRefillLocation.longitude },
        quantity: parcelCapacity
    });

    // Main delivery loop
    while (deliveryLocations.length > 0) {
        let parcelsToDeliver = Math.min(parcelCapacity, deliveryLocations.reduce((sum, loc) => sum + loc.quantity, 0));
        const formattedDeliveryLocations = deliveryLocations.map(loc => `${loc.coordinates.latitude},${loc.coordinates.longitude}`);

        const distances = await getDistances(currentLocation, formattedDeliveryLocations);
        const sortedDeliveries = deliveryLocations
            .map((loc, index) => ({
                location: loc.coordinates,
                distance: distances[index],
                quantity: loc.quantity
            }))
            .sort((a, b) => a.distance - b.distance);

        for (const { location, quantity } of sortedDeliveries) {
            if (parcelsToDeliver > 0 && quantity > 0) {
                const quantityToDeliver = Math.min(parcelsToDeliver, quantity);
                routeSteps.push({
                    action: 'deliver',
                    coordinates: { latitude: location.latitude, longitude: location.longitude },
                    quantity: quantityToDeliver
                });

                parcelsToDeliver -= quantityToDeliver;
                const orderIndex = deliveryLocations.findIndex(loc => 
                    loc.coordinates.latitude === location.latitude && loc.coordinates.longitude === location.longitude
                );
                if (orderIndex !== -1) {
                    deliveryLocations[orderIndex].quantity -= quantityToDeliver;
                    if (deliveryLocations[orderIndex].quantity <= 0) {
                        deliveryLocations.splice(orderIndex, 1);
                    }
                }
                currentLocation = `${location.latitude},${location.longitude}`;
            }
        }

        // Refill if more deliveries remain but stock is empty
        if (deliveryLocations.length > 0 && parcelsToDeliver === 0) {
            let optimalStore = null;
            let minTotalDistance = Infinity;

            for (let store of stockLocations) {
                const storeDistance = await getDistances(currentLocation, [`${store.latitude},${store.longitude}`]);
                const pendingDeliveryDistances = await getDistances(`${store.latitude},${store.longitude}`, formattedDeliveryLocations);
                const totalDistance = storeDistance[0] + pendingDeliveryDistances.reduce((sum, d) => sum + d, 0);

                if (totalDistance < minTotalDistance) {
                    minTotalDistance = totalDistance;
                    optimalStore = store;
                }
            }

            if (optimalStore) {
                const refillQuantity = Math.min(parcelCapacity, deliveryLocations.reduce((sum, loc) => sum + loc.quantity, 0));
                routeSteps.push({
                    action: 'refill',
                    coordinates: { latitude: optimalStore.latitude, longitude: optimalStore.longitude },
                    quantity: refillQuantity
                });
                currentLocation = `${optimalStore.latitude},${optimalStore.longitude}`;
            }
        }
    }

    return routeSteps.map(step => ({
        action: step.action,
        coordinates: {
            latitude: step.coordinates.latitude,
            longitude: step.coordinates.longitude
        },
        quantity: step.quantity
    }));
}
