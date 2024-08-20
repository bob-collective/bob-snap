import { address, Network, opcodes, Psbt, script, Transaction } from 'bitcoinjs-lib';
import { getNetwork } from './getNetwork';
import { BitcoinNetwork } from '../interface';

export class PsbtHelper {
  private psbt: Psbt;
  private network: Network;

  constructor(psbt: Psbt, network: BitcoinNetwork) {
    this.network = getNetwork(network);
    this.psbt = psbt;
  }

  get inputAmount() {
    return this.psbt.data.inputs.reduce((total, input, index) => {
      const vout = this.psbt.txInputs[index].index;
      const prevTx = Transaction.fromHex(input.nonWitnessUtxo.toString('hex'));
      return total + prevTx.outs[vout].value;
    }, 0);
  }

  get sendAmount() {
    return this.psbt.txOutputs
      .filter(output => !this.changeAddresses.includes(output.address))
      .reduce((amount, output) => amount + output.value, 0);
  }

  get fee() {
    const outputAmount = this.psbt.txOutputs.reduce((amount, output) => amount + output.value, 0);
    return this.inputAmount - outputAmount;
  }

  get fromAddresses() {
    return this.psbt.data.inputs.map((input, index) => {
      const prevOuts = Transaction.fromHex(input.nonWitnessUtxo.toString('hex')).outs
      const vout = this.psbt.txInputs[index].index;
      return address.fromOutputScript(prevOuts[vout].script, this.network)
    })
  }

  get toAddresses() {
    return this.psbt.txOutputs.map(output => {
      if (output.address == null) {
        const scriptPubKey = script.decompile(output.script);
        if (scriptPubKey.length == 2 && scriptPubKey[0] == opcodes.OP_RETURN && Buffer.isBuffer(scriptPubKey[1])) {
          return `OP_RETURN 0x${scriptPubKey[1].toString("hex")}`;
        } else {
          return "Unknown";
        }
      } else {
        return output.address;
      }
    }).filter(address => !this.changeAddresses.includes(address));
  }

  get changeAddresses() {
    return this.psbt.data.outputs
      .map((output, index) => output.bip32Derivation ? this.psbt.txOutputs[index].address : undefined)
      .filter(address => !!address)
  }
}
