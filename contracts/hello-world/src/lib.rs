#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, Address, Bytes, BytesN, Env, Symbol, Vec,
};

use soroban_sdk::panic_with_error;

#[contracttype]
#[derive(Clone)]
pub struct FlightDetails {
    pub id: BytesN<32>,        
    pub max_passengers: u32,
    pub distance: i128,
    pub src: Symbol,
    pub dest: Symbol,
    pub status: Symbol,
    pub escrow_amount: i128,
    pub passenger_count: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct PassengerRecord {
    pub passenger: Address,
    pub paid: i128,
    pub details: Symbol,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Flight(BytesN<32>),
    RouteRegistry(Symbol, Symbol),
    GlobalRegistry,
    PassengerList(BytesN<32>),
    PassengerRegistry(Address),
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FlyStellarError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    FlightAlreadyExists = 3,
    FlightNotFound = 4,
    InvalidInput = 5,
    FlightFull = 6,
    InvalidFare = 7,
    PassengerNotFound = 8,
    InvalidStatus = 9,
    NoPassengers = 10,
}

#[contract]
pub struct FlyStellar;

#[contractimpl]
impl FlyStellar {

    pub fn __constructor(env: Env, admin: Address) {
    
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, FlyStellarError::AlreadyInitialized);
        }
        
        env.storage().instance().set(&DataKey::Admin, &admin);

        env.storage().persistent().set(&DataKey::GlobalRegistry, &Vec::<BytesN<32>>::new(&env));
    }

    fn require_admin(env: &Env) -> Address {
        let admin: Address = env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();
        admin.require_auth();
        admin
    }

    pub fn create_flight(
        env: Env,
        flight_id: BytesN<32>,
        max_passengers: u32,
        distance: i128,
        src: Symbol,
        dest: Symbol,
    ) {
        Self::require_admin(&env);

        if max_passengers == 0 || distance <= 0 {
            panic_with_error!(&env, FlyStellarError::InvalidInput);
        }

        let flight_key = DataKey::Flight(flight_id.clone());
        if env.storage().persistent().has(&flight_key) {
            panic_with_error!(&env, FlyStellarError::FlightAlreadyExists);
        }

        let escrow = (max_passengers as i128)
            .checked_mul(distance)
            .expect("escrow overflow");

        let details = FlightDetails {
            id: flight_id.clone(),
            max_passengers,
            distance,
            src: src.clone(),
            dest: dest.clone(),
            status: Symbol::new(&env, "booking"),
            escrow_amount: escrow,
            passenger_count: 0,
        };

        env.storage().persistent().set(&flight_key, &details);

        let route_key = DataKey::RouteRegistry(src.clone(), dest.clone());
        let mut registry: Vec<BytesN<32>> = env.storage()
            .persistent()
            .get(&route_key)
            .unwrap_or(Vec::new(&env));
        registry.push_back(flight_id.clone());
        env.storage().persistent().set(&route_key, &registry);

        let mut global: Vec<BytesN<32>> = env.storage()
            .persistent()
            .get(&DataKey::GlobalRegistry)
            .unwrap_or(Vec::new(&env));
        global.push_back(flight_id);
        env.storage().persistent().set(&DataKey::GlobalRegistry, &global);

    }

    /// Buy a ticket for a flight
    pub fn buy_ticket(env: Env, flight_id: BytesN<32>, passenger: Address, details: Symbol) {
        // Passenger must authorize this action
        passenger.require_auth();

        let flight_key = DataKey::Flight(flight_id.clone());
        
        // Get flight details
        let mut flight: FlightDetails = env.storage()
            .persistent()
            .get(&flight_key)
            .expect("Flight not found");

        // Validate flight status and capacity
        if flight.status != Symbol::new(&env, "booking") {
            panic_with_error!(&env, FlyStellarError::InvalidStatus);
        }
        if flight.passenger_count >= flight.max_passengers {
            panic_with_error!(&env, FlyStellarError::FlightFull);
        }

        let fare = flight.distance;
        if fare <= 0 {
            panic_with_error!(&env, FlyStellarError::InvalidFare);
        }

        // TODO: require token transfer of `fare` from `passenger` to contract escrow here.
        // Example: token_client.transfer(&passenger, &env.current_contract_address(), &fare);

        // Create passenger record
        let record = PassengerRecord {
            passenger: passenger.clone(),
            paid: fare,
            details,
        };

        let pass_list_key = DataKey::PassengerList(flight_id.clone());
        let mut pass_list: Vec<PassengerRecord> = env.storage()
            .persistent()
            .get(&pass_list_key)
            .unwrap_or(Vec::new(&env));
        pass_list.push_back(record);
        env.storage().persistent().set(&pass_list_key, &pass_list);

        // Add to passenger's flight registry
        let pass_reg_key = DataKey::PassengerRegistry(passenger.clone());
        let mut pass_registry: Vec<BytesN<32>> = env.storage()
            .persistent()
            .get(&pass_reg_key)
            .unwrap_or(Vec::new(&env));
        pass_registry.push_back(flight_id.clone());
        env.storage().persistent().set(&pass_reg_key, &pass_registry);

        // Update passenger count
        flight.passenger_count = flight.passenger_count.checked_add(1).expect("passenger count overflow");
        env.storage().persistent().set(&flight_key, &flight);
    }

    /// Cancel a ticket and get refund
    pub fn cancel_ticket(env: Env, flight_id: BytesN<32>, passenger: Address) {
        // Passenger must authorize cancellation
        passenger.require_auth();

        let flight_key = DataKey::Flight(flight_id.clone());
        
        // Get flight details
        let mut flight: FlightDetails = env.storage()
            .persistent()
            .get(&flight_key)
            .expect("Flight not found");

        // Get passenger list
        let pass_list_key = DataKey::PassengerList(flight_id.clone());
        let pass_list: Vec<PassengerRecord> = env.storage()
            .persistent()
            .get(&pass_list_key)
            .expect("No passengers");

        let mut new_list: Vec<PassengerRecord> = Vec::new(&env);
        let mut found = false;
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();

        // Process refund (90% to passenger, 10% admin fee)
        for rec in pass_list.iter() {
            if rec.passenger == passenger {
                found = true;
                let refund_90 = rec.paid * 9 / 10;
                let admin_fee = rec.paid - refund_90;
                // TODO: Implement token transfers
                // token_client.transfer(&env.current_contract_address(), &passenger, &refund_90);
                // token_client.transfer(&env.current_contract_address(), &admin, &admin_fee);
                let _ = (refund_90, admin_fee); // Suppress unused warning
            } else {
                new_list.push_back(rec);
            }
        }

        if !found {
            panic_with_error!(&env, FlyStellarError::PassengerNotFound);
        }

        env.storage().persistent().set(&pass_list_key, &new_list);

        flight.passenger_count = flight.passenger_count.saturating_sub(1);
        env.storage().persistent().set(&flight_key, &flight);

        let pass_reg_key = DataKey::PassengerRegistry(passenger.clone());
        if env.storage().persistent().has(&pass_reg_key) {
            let reg: Vec<BytesN<32>> = env.storage().persistent().get(&pass_reg_key).unwrap();
            let mut new_reg: Vec<BytesN<32>> = Vec::new(&env);
            for id in reg.iter() {
                if id != flight_id {
                    new_reg.push_back(id);
                }
            }
            env.storage().persistent().set(&pass_reg_key, &new_reg);
        }
    }

    pub fn update_flight_status(env: Env, flight_id: BytesN<32>, new_status: Symbol) {
     
        Self::require_admin(&env);

        let flight_key = DataKey::Flight(flight_id.clone());
        
        let mut flight: FlightDetails = env.storage()
            .persistent()
            .get(&flight_key)
            .expect("Flight not found");

        let takeoff = Symbol::new(&env, "takeoff");
        let cancelled = Symbol::new(&env, "cancelled");
        
        if new_status != takeoff && new_status != cancelled {
            panic_with_error!(&env, FlyStellarError::InvalidStatus);
        }

        flight.status = new_status;
        env.storage().persistent().set(&flight_key, &flight);
    }

    pub fn get_flights_search(env: Env, src: Symbol, dest: Symbol) -> Vec<FlightDetails> {
        let route_key = DataKey::RouteRegistry(src, dest);
        let ids: Vec<BytesN<32>> = env.storage()
            .persistent()
            .get(&route_key)
            .unwrap_or(Vec::new(&env));

        let mut out: Vec<FlightDetails> = Vec::new(&env);
        for id in ids.iter() {
            let flight_key = DataKey::Flight(id);
            if let Some(f) = env.storage().persistent().get::<_, FlightDetails>(&flight_key) {
                out.push_back(f);
            }
        }
        out
    }

    pub fn get_flights_admin(env: Env) -> Vec<FlightDetails> {
        Self::require_admin(&env);

        let ids: Vec<BytesN<32>> = env.storage()
            .persistent()
            .get(&DataKey::GlobalRegistry)
            .unwrap_or(Vec::new(&env));

        let mut out: Vec<FlightDetails> = Vec::new(&env);
        for id in ids.iter() {
            let flight_key = DataKey::Flight(id);
            if let Some(f) = env.storage().persistent().get::<_, FlightDetails>(&flight_key) {
                out.push_back(f);
            }
        }
        out
    }

    pub fn get_flight_admin(env: Env, flight_id: BytesN<32>) -> FlightDetails {
        Self::require_admin(&env);
        
        let flight_key = DataKey::Flight(flight_id);
        env.storage()
            .persistent()
            .get(&flight_key)
            .expect("Flight not found")
    }

    pub fn get_flights_pass(env: Env, passenger: Address) -> Vec<FlightDetails> {
        let pass_reg_key = DataKey::PassengerRegistry(passenger);
        let ids: Vec<BytesN<32>> = env.storage()
            .persistent()
            .get(&pass_reg_key)
            .unwrap_or(Vec::new(&env));

        let mut out: Vec<FlightDetails> = Vec::new(&env);
        for id in ids.iter() {
            let flight_key = DataKey::Flight(id);
            if let Some(f) = env.storage().persistent().get::<_, FlightDetails>(&flight_key) {
                out.push_back(f);
            }
        }
        out
    }
}