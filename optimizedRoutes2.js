import orderModel from "../feature/orders/orderSchema.js";
import inventoryModel from "../feature/inventories/inventorySchema.js";
import axios from "axios";

export default async function calculateSortestRoutes(req, res, next) {
    try {
        const orders = await orderModel.find({ orderStatus: "pending" }).populate("user");
        const deliveryLocations = orders.map(order => ({
            coordinates: order.user.coordinates,
            quantity: order.quantity
        })).filter(coords => coords.coordinates?.latitude && coords.coordinates?.longitude);

        const parcelCapacity = 30;
        const myInfo = orders.find(order => order.user.email === "namasudrasuranjit164@gmail.com");
        const startingLocation = myInfo?.user?.coordinates || { latitude: 27.4656118, longitude: 94.9022926 };

        const inventories = await inventoryModel.find({}).limit(2);
        const stockLocations = inventories
            .map(inv => inv.coordinates)
            .filter(coords => coords?.latitude && coords?.longitude);

        const fullRoute = await calculateOptimalRoute({
            deliveryLocations,
            stockLocations,
            parcelCapacity,
            startingLocation
        });

        const { route1, route2 } = splitOptimizedRoute(fullRoute);

        const optimizedRoute1 = await calculateOptimalRoute({ 
            deliveryLocations: route1.map(step => ({ coordinates: step.coordinates, quantity: step.quantity })), 
            stockLocations, 
            parcelCapacity, 
            startingLocation 
        });

        const optimizedRoute2 = await calculateOptimalRoute({ 
            deliveryLocations: route2.map(step => ({ coordinates: step.coordinates, quantity: step.quantity })), 
            stockLocations, 
            parcelCapacity, 
            startingLocation 
        });

        console.log("Optimized routes: ", { optimizedRoute1, optimizedRoute2 });
        return res.json({
            success: true,
            message: "Optimized routes for delivery personnel calculated successfully!",
            data: { optimizedRoute1, optimizedRoute2 }
        });
    } catch (error) {
        console.error("Error calculating optimized delivery routes:", error);
        return res.status(500).json({ success: false, message: "Error calculating routes", error: error.message });
    }
}

async function calculateOptimalRoute(data) {
    const { deliveryLocations, stockLocations, parcelCapacity, startingLocation } = data;
    let currentLocation = `${startingLocation.latitude},${startingLocation.longitude}`;
    const routeSteps = [];

    while (deliveryLocations.length > 0) {
        let parcelsToDeliver = Math.min(parcelCapacity, deliveryLocations.reduce((sum, loc) => sum + loc.quantity, 0));

        while (parcelsToDeliver > 0 && deliveryLocations.length > 0) {
            const formattedDeliveryLocations = deliveryLocations.map(loc => `${loc.coordinates.latitude},${loc.coordinates.longitude}`);
            const distances = await getDistances(currentLocation, formattedDeliveryLocations);

            const sortedDeliveries = deliveryLocations
                .map((loc, index) => ({
                    location: loc.coordinates,
                    distance: distances[index],
                    quantity: loc.quantity
                }))
                .sort((a, b) => a.distance - b.distance);

            const { location, quantity } = sortedDeliveries[0];
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

        if (deliveryLocations.length > 0 && parcelsToDeliver === 0) {
            let optimalStore = null;
            let minTotalDistance = Infinity;

            const formattedDeliveryLocations = deliveryLocations.map(loc => `${loc.coordinates.latitude},${loc.coordinates.longitude}`);

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

function splitOptimizedRoute(routeSteps) {
    const half = Math.ceil(routeSteps.length / 2);
    const route1 = routeSteps.slice(0, half);
    const route2 = routeSteps.slice(half);

    return { route1, route2 };
}

async function getDistances(origin, destinations) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destinations.join('|')}&key=${apiKey}`;

    try {
        const response = await axios.get(url);
        return response.data.rows[0].elements.map(element => element.distance.value);
    } catch (error) {
        console.error("Error fetching distances:", error);
        return [];
    }
}
