import React, { Component } from 'react';
import Sync from '../lib/sync'
import Auth from '../lib/auth'
import ModelManager from '../lib/modelManager'
import ComponentManager from '../lib/componentManager'
import Note from '../models/app/note'
import Abstract from "./Abstract"
import Icons from '../Icons';
import App from '../app'
import LockedView from "../containers/LockedView";
import Icon from 'react-native-vector-icons/Ionicons';
var _ = require('lodash');

import TextView from "sn-textview";

import {
  StyleSheet,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Text
} from 'react-native';

import GlobalStyles from "../Styles"

export default class Compose extends Abstract {

  static navigatorStyle = {
    tabBarHidden: true
  };

  constructor(props) {
    super(props);
    var note = ModelManager.getInstance().findItem(props.noteId);
    if(!note) {
      note = ModelManager.getInstance().createItem({content_type: "Note", dummy: true, text: ""});
      ModelManager.getInstance().addItem(note);
      note.dummy = true;
    }

    this.note = note;
    this.constructState({title: note.title, text: note.text});

    this.loadStyles();

    this.syncObserver = Sync.getInstance().registerSyncObserver((changesMade, retreived, saved) => {
      if(retreived && this.note.uuid && retreived.map((i) => i.uuid).includes(this.note.uuid)) {
        this.refreshContent();
      }
    });

    this.configureNavBar(true);

    // A delay is required. Otherwise, on iOS, if loading without delay, then dismissing, clicking "Manage" doesn't work.
    setTimeout(() => {
      this.loadEditor();
    }, App.isIOS ? 550 : 200);
  }

  refreshContent() {
    this.mergeState({title: this.note.title, text: this.note.text});
  }

  loadEditor() {
    var noteEditor = ComponentManager.get().editorForNote(this.note);

    if(noteEditor) {
      let presentEditor = () => {
        this.presentedEditor = true;
        this.props.navigator.showModal({
          screen: 'sn.Webview',
          title: noteEditor.name,
          animationType: 'slide-up',
          passProps: {
            noteId: this.note.uuid,
            editorId: noteEditor.uuid
          }
        });
      }
      if(!this.note.uuid) {
        this.note.initUUID().then(() => {
          presentEditor();
        })
      } else {
        presentEditor();
      }
    }
  }

  componentWillUnmount() {
    super.componentWillUnmount();
    Sync.getInstance().removeSyncObserver(this.syncObserver);
  }

  viewDidAppear() {
    super.viewDidAppear();

    // Autofocus doesn't work properly on iOS due to navigation push, so we'll focus manually
    if(App.isIOS) {
      if(this.note.dummy) {
        this.input.focus();
      }
    }
  }

  // on iOS, declaring nav bar buttons as static prevents the flickering issue that occurs on nav push

  static navigatorButtons = Platform.OS == 'android' ? {} : {
    rightButtons: [{
      title: "Manage",
      id: 'tags',
      showAsAction: 'ifRoom',
    }]
  };

  configureNavBar(initial) {
    super.configureNavBar();

    // Only edit the nav bar once, it wont be changed
    if(!initial) {
      return;
    }

    var tagButton = {
      title: "Manage",
      id: 'tags',
      showAsAction: 'ifRoom',
    }

    if(Platform.OS === "android") {
      tagButton.icon = Icons.getIcon("md-pricetag");
    }

    if(!this.note.uuid) {
      if(App.isIOS) {
        tagButton.disabled = true;
      } else {
        tagButton = {};
      }
    }

    this.props.navigator.setButtons({
      rightButtons: [tagButton],
      animated: false
    });
  }

  onNavigatorEvent(event) {
    super.onNavigatorEvent(event);

    if(event.id == 'didAppear') {
      if(this.note.dummy) {
        if(this.refs.input) {
          this.refs.input.focus();
        }
      }
    } else if(event.id == "willAppear") {
      // Changes made in an external editor are not reflected automatically
      if(this.presentedEditor) {
        this.presentedEditor = false;
        this.refreshContent();
      }

      if(this.note.dirty) {
        // We want the "Saving..." / "All changes saved..." subtitle to be visible to the user, so we delay
        setTimeout(() => {
          this.changesMade();
        }, 300);
      }
    }
    if (event.type == 'NavBarButtonPress') {
      if (event.id == 'tags') {
        this.showOptions();
      }
    }
  }

  showOptions() {
    if(App.isAndroid) {
      this.input.blur();
    }

    this.previousOptions = {selectedTags: this.note.tags.map(function(tag){return tag.uuid})};
    this.props.navigator.push({
      screen: 'sn.Filter',
      title: 'Options',
      animationType: 'slide-up',
      passProps: {
        noteId: this.note.uuid,
        onManageNoteEvent: () => {this.forceUpdate()},
        singleSelectMode: false,
        options: JSON.stringify(this.previousOptions),
        onEditorSelect: () => {this.presentedEditor = true},
        onOptionsChange: (options) => {
          if(!_.isEqual(options.selectedTags, this.previousOptions.selectedTags)) {
            var tags = ModelManager.getInstance().getItemsWithIds(options.selectedTags);
            this.note.replaceTags(tags);
            this.note.setDirty(true);
            this.changesMade();
          }
        }
      }
    });
  }

  onTitleChange = (text) => {
    this.mergeState({title: text})
    this.note.title = text;
    this.changesMade();
  }

  onTextChange = (text) => {
    this.note.text = text;
    this.changesMade();
  }

  changesMade() {
    this.note.hasChanges = true;

    if(this.saveTimeout) clearTimeout(this.saveTimeout);
    if(this.statusTimeout) clearTimeout(this.statusTimeout);
    this.saveTimeout = setTimeout(function(){
      this.setNavBarSubtitle("Saving...");
      if(!this.note.uuid) {
        this.note.initUUID().then(function(){
          if(this.props.selectedTagId) {
            var tag = ModelManager.getInstance().findItem(this.props.selectedTagId);
            this.note.addItemAsRelationship(tag);
            tag.addItemAsRelationship(this.note);
          }
          this.save();
          this.configureNavBar(true);
        }.bind(this));
      } else {
        this.save();
      }
    }.bind(this), 275)
  }

  sync(note, callback) {
    note.setDirty(true);

    Sync.getInstance().sync(function(response){
      if(response && response.error) {
        if(!this.didShowErrorAlert) {
          this.didShowErrorAlert = true;
          // alert("There was an error saving your note. Please try again.");
        }
        if(callback) {
          callback(false);
        }
      } else {
        note.hasChanges = false;
        if(callback) {
          callback(true);
        }
      }
    }.bind(this))
  }

  save() {
    var note = this.note;
    if(note.dummy) {
      note.dummy = false;
      ModelManager.getInstance().addItem(note);
    }
    this.sync(note, function(success){
      if(success) {
        if(this.statusTimeout) clearTimeout(this.statusTimeout);
        this.statusTimeout = setTimeout(function(){
          var status = "All changes saved"
          if(Auth.getInstance().offline()) {
            status += " (offline)";
          }
          this.saveError = false;
          this.syncTakingTooLong = false;
          this.noteStatus = this.setNavBarSubtitle(status);
        }.bind(this), 200)
      } else {
        if(this.statusTimeout) clearTimeout(this.statusTimeout);
        this.statusTimeout = setTimeout(function(){
          this.saveError = true;
          this.syncTakingTooLong = false;
          this.setNavBarSubtitle("Error syncing (changes saved offline)");
        }.bind(this), 200)
      }
    }.bind(this));
  }

  setNavBarSubtitle(title) {
    if(!this.visible || !this.willBeVisible) {
      return;
    }

    this.props.navigator.setSubTitle({
      subtitle: title
    });

    var color = GlobalStyles.constantForKey(App.isIOS ? "mainTextColor" : "navBarTextColor");
    this.props.navigator.setStyle({
      navBarSubtitleColor: GlobalStyles.hexToRGBA(color, 0.5),
      navBarSubtitleFontSize: 12
    });
  }

  render() {
    if(this.state.lockContent) {
      return (<LockedView />);
    }

    /*
      For the note text, we are using a custom component that is currently incapable of immediate re-renders on text
      change without flickering. So we do not use this.state.text for the value, but instead this.note.text.
      For the title however, we are not using a custom component and thus can (and must) look at the state value of
      this.state.title for the value. We also update the state onTitleChange.
    */

    return (
      <View style={[this.styles.container, GlobalStyles.styles().container]}>

        {this.note.locked &&
          <View style={this.styles.lockedContainer}>
            <Icon name={Icons.nameForIcon("lock")} size={20} color={GlobalStyles.constants().mainBackgroundColor} />
            <Text style={this.styles.lockedText}>Note Locked</Text>
          </View>
        }

        <TextInput
          style={this.styles.noteTitle}
          onChangeText={this.onTitleChange}
          value={this.state.title}
          placeholder={"Add Title"}
          selectionColor={GlobalStyles.constants().mainTintColor}
          underlineColorAndroid={'transparent'}
          placeholderTextColor={GlobalStyles.constants().mainDimColor}
          autoCorrect={true}
          autoCapitalize={'sentences'}
          editable={!this.note.locked}
        />

        {Platform.OS == "android" &&
          <View style={this.styles.noteTextContainer}>
            <TextView style={[GlobalStyles.stylesForKey("noteText")]}
              ref={(ref) => this.input = ref}
              autoFocus={this.note.dummy}
              value={this.note.text}
              selectionColor={GlobalStyles.lighten(GlobalStyles.constants().mainTintColor, 0.35)}
              handlesColor={GlobalStyles.constants().mainTintColor}
              onChangeText={this.onTextChange}
              editable={!this.note.locked}
            />
          </View>
        }

        {Platform.OS == "ios" &&
          <TextView style={[...GlobalStyles.stylesForKey("noteText"), {paddingBottom: 10}]}
            ref={(ref) => this.input = ref}
            autoFocus={false}
            value={this.note.text}
            keyboardDismissMode={'interactive'}
            selectionColor={GlobalStyles.lighten(GlobalStyles.constants().mainTintColor)}
            onChangeText={this.onTextChange}
            editable={!this.note.locked}
          />
        }
      </View>
    );
  }

  loadStyles() {
    this.rawStyles = {
      container: {
        flex: 1,
        flexDirection: 'column',
        height: "100%",
      },

      noteTitle: {
        fontWeight: "600",
        fontSize: 16,
        color: GlobalStyles.constants().mainTextColor,
        height: 50,
        borderBottomColor: GlobalStyles.constants().composeBorderColor,
        borderBottomWidth: 1,
        paddingTop: Platform.OS === "ios" ? 5 : 12,
        paddingLeft: GlobalStyles.constants().paddingLeft,
        paddingRight: GlobalStyles.constants().paddingLeft,
      },

      lockedContainer: {
        flex: 1,
        justifyContent: 'flex-start',
        flexDirection: 'row',
        alignItems: "center",
        height: 30,
        maxHeight: 30,
        paddingLeft: GlobalStyles.constants().paddingLeft,
        backgroundColor: GlobalStyles.constants().mainTintColor,
        borderBottomColor: GlobalStyles.constants().plainCellBorderColor,
        borderBottomWidth: 1
      },

      lockedText: {
        fontWeight: "bold",
        color: GlobalStyles.constants().mainBackgroundColor,
        paddingLeft: 10
      },

      textContainer: {
        flexGrow: 1,
        flex: 1,
      },

      contentContainer: {
        flexGrow: 1,
      },

      noteTextContainer: {
        flexGrow: 1,
        flex: 1,
      },
    }

    this.styles = StyleSheet.create(this.rawStyles);

  }
}
