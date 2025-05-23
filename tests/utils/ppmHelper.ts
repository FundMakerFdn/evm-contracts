import {
  keccak256,
  toHex,
  parseAbiParameters,
  encodeAbiParameters,
  concat,
  pad,
  Address,
  Hex,
  ByteArray,
  hexToBytes,
} from 'viem';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

// Define types for the PPM items
type PPMItemType =
  | 'whitelistSMA'
  | 'deploySMA'
  | 'callSMA'
  | 'custodyToAddress'
  | 'custodyToSMA'
  | 'changeCustodyState'
  | 'custodyToCustody'
  | 'updatePPM'
  | 'updateCustodyState';

interface Party {
  parity: number;
  x: Hex;
}

interface PPMItemExpanded {
  type: PPMItemType;
  chainId: number;
  pSymm: Address;
  state: number;
  args: Hex;
  party: Party | Party[];
}

export enum SMAType {
  CCIP,
  UNISWAPV3,
  AAVE,
  ACROSS,
  ONEINCH,
}

class PPMHelper {
  private ppmItems: PPMItemExpanded[];
  private merkleTree: StandardMerkleTree<any[]> | null;
  private argsToTypes: Record<PPMItemType, string>;
  private readonly chainId: number;
  private readonly ppmAddress: Address;

  constructor(chainId: number, ppmAddress: Address) {
    this.chainId = chainId;
    this.ppmAddress = ppmAddress;
    this.ppmItems = [];
    this.merkleTree = null;
    this.argsToTypes = {
      whitelistSMA: 'uint8 smaType,address smaAddress',
      deploySMA: 'uint8 smaType,address factoryAddress,bytes callData',
      callSMA: 'uint8 smaType,address smaAddress,bytes callData',
      custodyToAddress: 'address receiver',
      custodyToSMA: 'address smaAddress,address token',
      changeCustodyState: 'uint8 newState',
      custodyToCustody: 'bytes32 receiverId',
      updatePPM: '', // No parameters
      updateCustodyState: '', // No parameters
    };
  }

  private encodeArgs(type: PPMItemType, args: Record<string, any>): Hex {
    // Special case for empty parameters (like updatePPM)
    if (this.argsToTypes[type] === '') {
      return '0x' as Hex;
    }

    const parsed = parseAbiParameters(this.argsToTypes[type]).slice(
      0,
      Object.keys(args).length
    );

    const argList: any[] = [];
    for (const { name } of parsed) {
      if (name && name in args) {
        argList.push(args[name]);
      }
    }

    return encodeAbiParameters(parsed, argList);
  }

  private encodeCalldata(funcType: string, funcArgs: any[]): Hex {
    // funcType example: "borrow(address,uint256)"
    // Ensure the selector is a valid Hex string
    const funcSig = toHex(funcType);
    const selector = keccak256(funcSig).slice(0, 10) as Hex;

    const paramTypes = funcType.slice(
      funcType.indexOf('(') + 1,
      funcType.lastIndexOf(')')
    );

    const params = encodeAbiParameters(
      parseAbiParameters(paramTypes).slice(0, funcArgs.length),
      funcArgs
    );

    // Convert to ByteArray first, then concat, then back to Hex
    const selectorBytes = hexToBytes(selector);
    const paramsBytes = hexToBytes(params);
    const concatenated = concat([selectorBytes, paramsBytes]);

    return toHex(concatenated);
  }

  private addItem(
    type: PPMItemType,
    args: Record<string, any>,
    state: number,
    party: Party | Party[]
  ): number {
    let encodedArgs: Hex;

    // Handle special case for callSMA where callData might be an object
    if (
      type === 'callSMA' &&
      typeof args.callData === 'object' &&
      'type' in args.callData
    ) {
      const callDataObj = args.callData as { type: string; args: any[] };
      const callData = this.encodeCalldata(callDataObj.type, callDataObj.args);
      args = { ...args, callData };
    }

    encodedArgs = this.encodeArgs(type, args);

    const item: PPMItemExpanded = {
      type,
      chainId: this.chainId,
      pSymm: this.ppmAddress,
      state,
      args: encodedArgs,
      party,
    };

    this.ppmItems.push(item);
    // Invalidate the tree so it will be rebuilt on next access
    this.merkleTree = null;

    // Return the index of the newly added item
    return this.ppmItems.length - 1;
  }

  // Implementation of all supported actions
  whitelistSMA(
    smaType: SMAType,
    smaAddress: Address,
    state: number,
    party: Party | Party[]
  ): number {
    return this.addItem('whitelistSMA', { smaType, smaAddress }, state, party);
  }

  deploySMA(
    smaType: SMAType,
    factoryAddress: Address,
    callData: { type: string; args: any[] } | Hex,
    state: number,
    party: Party | Party[]
  ): number {
    return this.addItem(
      'deploySMA',
      { smaType, factoryAddress, callData },
      state,
      party
    );
  }

  callSMA(
    smaType: SMAType,
    smaAddress: Address,
    callData: { type: string; args: any[] } | Hex,
    state: number,
    party: Party | Party[]
  ): number {
    return this.addItem(
      'callSMA',
      { smaType, smaAddress, callData },
      state,
      party
    );
  }

  custodyToAddress(
    receiver: string,
    state: number,
    party: Party | Party[]
  ): number {
    return this.addItem('custodyToAddress', { receiver }, state, party);
  }

  custodyToSMA(
    smaAddress: Address | string,
    token: Address | string,
    state: number,
    party: Party | Party[]
  ): number {
    return this.addItem('custodyToSMA', { smaAddress, token }, state, party);
  }

  changeCustodyState(
    newState: number,
    state: number,
    party: Party | Party[]
  ): number {
    return this.addItem('changeCustodyState', { newState }, state, party);
  }

  custodyToCustody(
    receiverId: string | Hex,
    state: number,
    party: Party | Party[]
  ): number {
    return this.addItem('custodyToCustody', { receiverId }, state, party);
  }

  updatePPM(state: number, party: Party | Party[]): number {
    return this.addItem(
      'updatePPM',
      {}, // No parameters for updatePPM
      state,
      party
    );
  }

  updateCustodyState(state: number, party: Party | Party[]): number {
    return this.addItem('updateCustodyState', {}, state, party);
  }

  // Get all PPM items
  getPPM(): PPMItemExpanded[] {
    return this.ppmItems;
  }

  // Build or get the merkle tree
  private getMerkleTree(): StandardMerkleTree<any[]> {
    if (this.merkleTree !== null) {
      return this.merkleTree;
    }

    const values = this.ppmItems.flatMap((item) => {
      const parties = Array.isArray(item.party) ? item.party : [item.party];

      return parties.map((party) => [
        item.type,
        item.chainId,
        item.pSymm,
        item.state,
        item.args,
        party.parity,
        pad(party.x),
      ]);
    });

    this.merkleTree = StandardMerkleTree.of(values, [
      'string', // entry type
      'uint256', // chainId
      'address', // pSymm
      'uint8', // state
      'bytes', // abi.encode(args)
      'uint8', // party.parity
      'bytes32', // party.x
    ]);

    return this.merkleTree;
  }

  // Get custody ID (merkle root)
  getCustodyID(): Hex {
    const tree = this.getMerkleTree();
    return tree.root as Hex;
  }

  // Get merkle proof by index
  getMerkleProof(index: number): string[] {
    if (this.ppmItems.length == 1) {
      return []; // No proof for single item
    }
    if (index < 0 || index >= this.ppmItems.length) {
      throw new Error(
        `Invalid index: ${index}. Valid range is 0-${this.ppmItems.length - 1}`
      );
    }

    const tree = this.getMerkleTree();
    return tree.getProof(index);
  }

  // Get merkle proof by action details (useful when you have the action but not the index)
  getMerkleProofByAction(item: PPMItemExpanded): string[] {
    const tree = this.getMerkleTree();

    // Fix the iteration issue by using Array.from() to convert the iterator to an array
    const entries = Array.from(tree.entries());

    const parties = Array.isArray(item.party) ? item.party : [item.party];

    for (const party of parties) {
      for (const [i, value] of entries) {
        if (
          value[0] === item.type &&
          value[1] === item.chainId &&
          value[2] === item.pSymm &&
          value[3] === item.state &&
          value[4] === item.args &&
          value[5] === party.parity &&
          value[6] === pad(party.x)
        ) {
          return tree.getProof(i);
        }
      }
    }

    return [];
  }

  // Get merkle proof by action type and args
  getMerkleProofByTypeAndArgs(
    type: PPMItemType,
    args: Record<string, any>,
    state: number,
    party: Party | Party[]
  ): string[] | [] {
    // Create a temporary item with the provided parameters
    let encodedArgs: Hex;

    // Handle special case for callSMA where callData might be an object
    if (
      type === 'callSMA' &&
      typeof args.callData === 'object' &&
      'type' in args.callData
    ) {
      const callDataObj = args.callData as { type: string; args: any[] };
      const callData = this.encodeCalldata(callDataObj.type, callDataObj.args);
      args = { ...args, callData };
    }

    encodedArgs = this.encodeArgs(type, args);

    const tempItem: PPMItemExpanded = {
      type,
      chainId: this.chainId,
      pSymm: this.ppmAddress,
      state,
      args: encodedArgs,
      party,
    };

    // Use the existing function to find the proof
    return this.getMerkleProofByAction(tempItem);
  }

  // Get all actions with their corresponding indices and proofs
  getAllActionsWithProofs(): Array<{
    index: number;
    item: PPMItemExpanded;
    proof: string[];
  }> {
    const tree = this.getMerkleTree();

    return this.ppmItems.map((item, index) => ({
      index,
      item,
      proof: tree.getProof(index),
    }));
  }

  // Clear all items
  clear(): void {
    this.ppmItems = [];
    this.merkleTree = null;
  }
}

export { PPMHelper };
export type { PPMItemExpanded, Party };
