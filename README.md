# Fly Stellar: Anti-Overbooking & Private Ticketing Contract ✈️


https://github.com/user-attachments/assets/26d19963-54cb-41ce-abb0-13a4c2df63d9


## Project Title
**Fly Stellar: Decentralized Anti-Overbooking Smart Contract with Private Data Vault**

## Project Description
**Fly Stellar** is an **EC-level project** that solves **airline overbooking** and enforces **passenger data privacy**. This Soroban contract provides an immutable, transparent ledger for capacity management, strictly limiting ticket sales to available seats. Crucially, it adopts a unique security model: the **Flight ID is the Cryptographic Public Key** for that flight.
1.  When a flight is created, the admin provides a Public Key, which becomes its unique on-chain identifier (the Flight ID).
2.  Passengers must **encrypt their sensitive booking details** using this **Public Key/Flight ID** before submission.
3.  The contract stores the encrypted data. The holder of the corresponding **Private Key** (the authorized airline/operator) is the *only one* capable of decrypting the passenger's information. This design links the primary identifier to the data's security, ensuring that sensitive data is only stored in an inaccessible, cryptographically secured form on the public blockchain.

## Project Vision
To establish a new, highly secure standard for air travel ticketing where **booking integrity (no overbooking)** and **user privacy** are guaranteed by design. The vision is to make the smart contract the single, trusted, and auditable source for ticket sales, while making **cryptographic privacy** an intrinsic property of the flight's identification.

## Key Features
* 🔑 **Cryptographic Flight ID (New Feature):** The `BytesN<32>` identifier for the flight now serves a dual role: it is the **unique Flight ID** and the **Public Key** required for encrypting passenger data.
* 🛡️ **Guaranteed Capacity Enforcement:** The core `book_ticket` function strictly checks the `passenger_count` against `max_passengers` to programmatically prevent overbooking.
* 🔐 **End-to-End Passenger Data Encryption:** Passenger details are stored on-chain as encrypted `Bytes`. Only the party holding the **Private Key** corresponding to the **Flight ID/Public Key** can access the sensitive data.
* 📊 **Public Availability Check:** The `get_flight` function allows any user to verify the current capacity and retrieve the Public Key (ID) needed for booking.
* ✍️ **Admin Capacity Control:** The administrator sets the definitive `max_passengers` and the initial Public Key (ID) via the `create_flight` function.

## Future Scope
* **Token Integration:** Implement token transfers for fare payments and refunds.
* **Key Derivation Standards:** Define and enforce the cryptographic standard (e.g., ECDSA, Ed25519) used to generate the Flight ID/Public Key pairs for maximum security.
* **Private Key Recovery:** Implement a secure, multi-signature recovery mechanism for the Private Key in case the primary holder is compromised.
* **Auditability Features:** Add events (Soroban logs) for all key actions (`create_flight`, `book_ticket`) to provide enhanced off-chain auditability.

## Contract Details
**Contract ID:** CBBMHNDDAWFFWYCILMSGUHVGOIULZ3NUPCWESO4N65XC5JO7QEXVHSRY
<img width="1912" height="865" alt="image" src="https://github.com/user-attachments/assets/028fa6cd-b122-4a0c-9166-641b58e02339" />


