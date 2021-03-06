import React, { Component } from 'react';
import { StyleSheet, View, FlatList, RefreshControl, ScrollView, Text, Modal, AppState } from 'react-native';
import NoteCell from "./NoteCell"
import Search from 'react-native-search-box'
import GlobalStyles from "../Styles"
import App from "../app"
import Authenticate from "../screens/Authenticate"
import ApplicationState from "../ApplicationState";

export default class AuthModal extends Component {

  constructor(props) {
    super(props);

    let mostRecentState = ApplicationState.get().getMostRecentState();
    let authProps = ApplicationState.get().getAuthenticationPropsForAppState(mostRecentState);
    this.state = {
      authProps: authProps,
      applicationState: mostRecentState,
      visible: (authProps.passcode || authProps.fingerprint) || false
    };
    this.stateChanged();
  }

  componentWillUnmount() {
    ApplicationState.get().removeStateObserver(this.stateObserver);
  }

  componentDidMount() {
    this.mounted = true;

    this.stateObserver = ApplicationState.get().addStateObserver((state) => {
      if(ApplicationState.get().isStateAppCycleChange(state) && !ApplicationState.get().isAuthenticationInProgress()) {
        let authProps = ApplicationState.get().getAuthenticationPropsForAppState(state);
        this.setState({
          authProps: authProps,
          applicationState: state,
          visible: (authProps.passcode || authProps.fingerprint) || false
        });
        this.stateChanged();
      }
    });

    if(this.beginAuthOnMount) {
      this.beginAuthOnMount = false;
      this.beginAuth();
    }
  }

  stateChanged() {
    // Once visible is true even once, we need to lock it in place,
    // and only make it in-visible after authentication completes.
    // This value is checked above in the application state observer to make sure we
    // don't accidentally change the value and dismiss this while its in view

    if(!ApplicationState.get().isAuthenticationInProgress()) {
      if(this.state.applicationState == ApplicationState.Launching || this.state.applicationState == ApplicationState.Resuming) {
        if(this.mounted && this.state.visible) {
          this.beginAuth();
        } else {
          this.beginAuthOnMount = true;
        }
      }
    }
  }

  beginAuth() {
    if(!this.state.visible) {
      console.error("Not supposed to call beginAuth before visible.");
    }

    try {
      this.refs.authenticate.beginAuthentication();
      ApplicationState.get().setAuthenticationInProgress(true);
    } catch (e) {
      console.error("Unable to begin auth", e);
    }
  }

  render() {
    let authProps = this.state.authProps;
    return (
      <Modal
       animationType={"slide"}
       transparent={false}
       visible={this.state.visible}
       onRequestClose={() => {}}>

        <Authenticate
          ref={'authenticate'}
          title={authProps.title}
          onAuthenticateSuccess={authProps.onAuthenticate}
          mode={"authenticate"}
          requirePasscode={authProps.passcode}
          requireFingerprint={authProps.fingerprint}
          pseudoModal={true}
          authProps={authProps}
        />
      </Modal>
    )
  }

}
