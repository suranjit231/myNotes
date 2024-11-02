
 ============== calculete most optimized routes ==========================//


export default async function calculateOptimalRoute(data) {
    const { deliveryLocations, stockLocations, parcelCapacity, startingLocation } = data;
    let currentLocation = `${startingLocation.latitude},${startingLocation.longitude}`;
    const routeSteps = [];


    //--------- looping over till the all delivery location is more then 0 ----------//
    while (deliveryLocations.length > 0) {

        //----- calculate the total parcels needed to deliver based on capacity and remaining quantity ------//
        let parcelsToDeliver = Math.min(parcelCapacity, deliveryLocations.reduce((sum, loc) => sum + loc.quantity, 0));

        while (parcelsToDeliver > 0 && deliveryLocations.length > 0) {

            //------ get distances from the current location to each remaining delivery location --------//
            const formattedDeliveryLocations = deliveryLocations.map(loc => `${loc.coordinates.latitude},${loc.coordinates.longitude}`);
            const distances = await getDistances(currentLocation, formattedDeliveryLocations);

            //------ sorting the delivery locations based on distance from the current location ---------//
            const sortedDeliveries = deliveryLocations
                .map((loc, index) => ({
                    location: loc.coordinates,
                    distance: distances[index],
                    quantity: loc.quantity
                }))
                .sort((a, b) => a.distance - b.distance);

            //------ select the closest delivery location and calculate delivery quantity ---------------//
            const { location, quantity } = sortedDeliveries[0];
            const quantityToDeliver = Math.min(parcelsToDeliver, quantity);

            //------ add delivery action to route steps for fronted --------------//
            routeSteps.push({
                action: 'deliver',
                coordinates: { latitude: location.latitude, longitude: location.longitude },
                quantity: quantityToDeliver
            });

            //------ update parcels to deliver and delivery locations ------------//
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

            //------- updating  current location to the latest delivery location --------//
            currentLocation = `${location.latitude},${location.longitude}`;
        }

        //-------------  checking if we need to refill stock before continuing -------------//
        if (deliveryLocations.length > 0 && parcelsToDeliver === 0) {
            let optimalStore = null;
            let minTotalDistance = Infinity;

            //--------- redefine formattedDeliveryLocations for the pending deliveries --------//
            const formattedDeliveryLocations = deliveryLocations.map(loc => `${loc.coordinates.latitude},${loc.coordinates.longitude}`);

            for (let store of stockLocations) {
                //---- calculate distances from current location to each stock 
                //----- location and from stock to each pending delivery
                
                const storeDistance = await getDistances(currentLocation, [`${store.latitude},${store.longitude}`]);
                const pendingDeliveryDistances = await getDistances(`${store.latitude},${store.longitude}`, formattedDeliveryLocations);
                
                //----- calculate the total distance for this store -----------//

                const totalDistance = storeDistance[0] + pendingDeliveryDistances.reduce((sum, d) => sum + d, 0);

                console.log("totalDistanced: ", totalDistance + " " + store);

                //----- select the store with the minimum total distance -------//
                if (totalDistance < minTotalDistance) {
                    minTotalDistance = totalDistance;
                    optimalStore = store;
                }
            }

           

            if (optimalStore) {
              // const refillQuantity = Math.min(parcelCapacity, deliveryLocations.reduce((sum, loc) => sum + loc.quantity, 0));
              const refillQuantity = parcelCapacity;

              console.log("optimal store: ", optimalStore);
                
              // const refillQuantity = 30;
                //------ add refill action to route steps ------------//
                routeSteps.push({
                    action: 'refill',
                    coordinates: { latitude: optimalStore.latitude, longitude: optimalStore.longitude },
                    quantity: refillQuantity
                });

                //-------- update current location to the stock location ------//
                currentLocation = `${optimalStore.latitude},${optimalStore.longitude}`;
                
            }
        }
    }

    //---------- return the route steps in the specified format for frontend ----------//
    return routeSteps.map(step => ({
        action: step.action,
        coordinates: {
            latitude: step.coordinates.latitude,
            longitude: step.coordinates.longitude
        },
        quantity: step.quantity 
    }));
}
